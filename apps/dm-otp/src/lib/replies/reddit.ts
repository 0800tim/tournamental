/**
 * Reddit DM outbound reply adapter.
 *
 * Posts to /api/compose with a script-app OAuth token. The token is
 * obtained server-side via password grant against the bot's own
 * Reddit account; we cache it in-memory until expiry.
 *
 * https://www.reddit.com/dev/api/#POST_api_compose
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface RedditReplyConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  userAgent: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(
  cfg: RedditReplyConfig,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username: cfg.username,
    password: cfg.password,
  });
  const res = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': cfg.userAgent,
    },
    body,
  });
  if (!res.ok) throw new Error(`reddit-token-failed:${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

/** Test helper: clear the cached OAuth token. */
export function _resetRedditTokenCacheForTests(): void {
  cachedToken = null;
}

export async function sendRedditOtp(
  cfg: RedditReplyConfig,
  recipientUsername: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  let token: string;
  try {
    token = await getToken(cfg, fetchImpl);
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
  const body = new URLSearchParams({
    api_type: 'json',
    subject: 'VTourn login code',
    text: otpMessageBody(code),
    to: recipientUsername,
  });
  const res = await fetchImpl('https://oauth.reddit.com/api/compose', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': cfg.userAgent,
    },
    body,
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'reddit-send-failed' };
  }
  return { ok: true, status: res.status };
}

/**
 * Poll Reddit's inbox for unread messages. Returned shape mirrors what
 * the inbound dispatcher expects: { id, fromUsername, body }.
 *
 * https://www.reddit.com/dev/api/#GET_message_unread
 */
export interface InboxMessage {
  id: string;
  fromUsername: string;
  body: string;
  createdAt: number;
}

export async function pollRedditInbox(
  cfg: RedditReplyConfig,
  deps: AdapterDeps = {},
): Promise<InboxMessage[]> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const token = await getToken(cfg, fetchImpl);
  const res = await fetchImpl(
    'https://oauth.reddit.com/message/unread?limit=25',
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': cfg.userAgent,
      },
    },
  );
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };
  const out: InboxMessage[] = [];
  for (const child of data.data?.children ?? []) {
    const d = child.data ?? {};
    const id = typeof d.name === 'string' ? d.name : '';
    const author = typeof d.author === 'string' ? d.author : '';
    const body = typeof d.body === 'string' ? d.body : '';
    const created = typeof d.created_utc === 'number' ? d.created_utc * 1000 : Date.now();
    if (id && author) out.push({ id, fromUsername: author, body, createdAt: created });
  }
  // Mark them read so we don't re-process.
  if (out.length) {
    const ids = out.map((m) => m.id).join(',');
    await fetchImpl('https://oauth.reddit.com/api/read_message', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': cfg.userAgent,
      },
      body: new URLSearchParams({ id: ids }),
    });
  }
  return out;
}
