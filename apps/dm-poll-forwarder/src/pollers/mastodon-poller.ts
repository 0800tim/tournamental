/**
 * Mastodon DM poller.
 *
 * Polls one or more Mastodon instances' `/api/v1/conversations` endpoint
 * (https://docs.joinmastodon.org/methods/conversations/). Each instance
 * has its own access token; we iterate them and merge the results.
 *
 * Cursor: a JSON-encoded mapping of `{ "mastodon.social": "<lastConvId>", ... }`.
 * That keeps the cursor-store interface single-string per channel while
 * letting us track per-instance progress. On any malformed cursor (or
 * first run) we treat it as empty.
 *
 * We only forward DMs whose `last_status.visibility === 'direct'` so a
 * misconfigured account that DMs publicly cannot accidentally trigger
 * an OTP. We also skip our own outbound replies via the `unread` flag.
 */

import type { Channel, PollMessage } from '../types.js';
import type { Poller, PollResult } from './types.js';

export interface MastodonInstanceConfig {
  /** Hostname only, no scheme. e.g. "mastodon.social" */
  host: string;
  accessToken: string;
}

export interface MastodonPollerOptions {
  instances: MastodonInstanceConfig[];
  fetch?: typeof fetch;
  /** Override scheme for testing (default https). */
  scheme?: string;
}

interface MastodonConversation {
  id: string;
  unread: boolean;
  accounts: { acct: string }[];
  last_status: { visibility: string; content?: string; plain_text?: string } | null;
}

export class MastodonPoller implements Poller {
  readonly channel: Channel = 'mastodon';
  readonly description = 'mastodon /api/v1/conversations';
  private readonly fetchImpl: typeof fetch;
  private readonly scheme: string;

  constructor(private readonly opts: MastodonPollerOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.scheme = opts.scheme ?? 'https';
  }

  async poll(previousCursor: string | undefined): Promise<PollResult> {
    const cursorMap = parseCursor(previousCursor);
    const messages: PollMessage[] = [];
    const nextCursor: Record<string, string> = { ...cursorMap };

    for (const inst of this.opts.instances) {
      const last = cursorMap[inst.host];
      const url = `${this.scheme}://${inst.host}/api/v1/conversations?limit=20${
        last ? `&since_id=${encodeURIComponent(last)}` : ''
      }`;
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${inst.accessToken}` },
      });
      if (!res.ok) {
        // Surface the failure so the scheduler records it; don't silently
        // succeed with a partial result.
        throw new Error(`mastodon-${inst.host}-${res.status}`);
      }
      const items = (await res.json()) as MastodonConversation[];
      // API returns newest-first; emit oldest-first so cursor monotonically advances.
      const usable = items
        .filter((c) => c.unread && c.last_status?.visibility === 'direct')
        .filter((c) => c.accounts?.length > 0)
        .reverse();
      for (const c of usable) {
        const handle = c.accounts[0]!.acct.includes('@')
          ? c.accounts[0]!.acct
          : `${c.accounts[0]!.acct}@${inst.host}`;
        const text = htmlToText(c.last_status?.content ?? c.last_status?.plain_text ?? '');
        messages.push({
          channel: this.channel,
          externalId: handle,
          text,
          cursor: encodeCursor({ ...nextCursor, [inst.host]: c.id }),
          meta: { instance: inst.host, conversationId: c.id },
        });
        nextCursor[inst.host] = c.id;
      }
    }
    if (messages.length === 0) return { messages: [], cursor: previousCursor };
    return { messages, cursor: encodeCursor(nextCursor) };
  }
}

function parseCursor(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    return {};
  } catch {
    return {};
  }
}

function encodeCursor(map: Record<string, string>): string {
  return JSON.stringify(map);
}

/**
 * Mastodon's `content` field is HTML (`<p>...</p>`). We strip tags and
 * decode the small handful of entities a 6-digit OTP message could
 * contain. We don't pull in a full HTML parser — the message bodies
 * are tiny and well-formed.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>(?!<)/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Re-exported for tests.
export const _internal = { parseCursor, encodeCursor, htmlToText };
