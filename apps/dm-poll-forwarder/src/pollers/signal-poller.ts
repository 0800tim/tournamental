/**
 * Signal DM poller.
 *
 * Talks to a self-hosted signal-cli REST gateway
 * (https://github.com/bbernhard/signal-cli-rest-api). Polls
 * `GET /v1/receive/{number}` which returns an array of envelope objects
 * containing dataMessage entries.
 *
 * Cursor: signal-cli's REST API returns each envelope with a
 * `timestamp` (ms since epoch). We use `<timestamp>:<sourceUuid>` as the
 * cursor so two envelopes at the exact same ms still order
 * deterministically. The gateway also supports server-side state
 * tracking via `?ignore_attachments=true&ignore_stories=true`; we leave
 * those defaults to the operator.
 */

import type { Channel, PollMessage } from '../types.js';
import type { Poller, PollResult } from './types.js';

export interface SignalPollerOptions {
  /** Base URL of signal-cli REST proxy. */
  apiBaseUrl: string;
  /** The Signal phone number registered with the proxy (E.164). */
  botNumber: string;
  fetch?: typeof fetch;
}

interface SignalEnvelope {
  source?: string;
  sourceUuid?: string;
  sourceNumber?: string;
  timestamp?: number;
  dataMessage?: { message?: string };
}

export class SignalPoller implements Poller {
  readonly channel: Channel = 'signal';
  readonly description = 'signal-cli /v1/receive';
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly opts: SignalPollerOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.base = opts.apiBaseUrl.replace(/\/+$/, '');
  }

  async poll(previousCursor: string | undefined): Promise<PollResult> {
    const url = `${this.base}/v1/receive/${encodeURIComponent(this.opts.botNumber)}`;
    const res = await this.fetchImpl(url, { method: 'GET' });
    if (!res.ok) throw new Error(`signal-receive-${res.status}`);
    const envelopes = (await res.json()) as Array<{ envelope: SignalEnvelope }>;
    const items: Array<{ env: SignalEnvelope; cursor: string; from: string; text: string }> = [];
    for (const wrapper of envelopes) {
      const env = wrapper?.envelope ?? (wrapper as unknown as SignalEnvelope);
      if (!env || !env.dataMessage?.message) continue;
      const ts = env.timestamp ?? 0;
      const id = env.sourceUuid ?? env.source ?? env.sourceNumber ?? 'unknown';
      const cursor = `${ts.toString().padStart(15, '0')}:${id}`;
      if (previousCursor && cursor <= previousCursor) continue;
      const from = env.sourceNumber ?? env.source ?? env.sourceUuid ?? '';
      if (!from) continue;
      items.push({ env, cursor, from, text: env.dataMessage.message });
    }
    items.sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));
    if (items.length === 0) return { messages: [], cursor: previousCursor };
    const messages: PollMessage[] = items.map((it) => ({
      channel: this.channel,
      externalId: it.from,
      text: it.text,
      cursor: it.cursor,
      receivedAt: it.env.timestamp ?? Date.now(),
    }));
    return { messages, cursor: items[items.length - 1]!.cursor };
  }
}
