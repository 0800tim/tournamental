/**
 * Mastodon outbound reply adapter.
 *
 * Posts a status with visibility=direct mentioning the user. Inbound
 * is via the streaming API or the `/api/v1/notifications` poll.
 *
 * https://docs.joinmastodon.org/methods/statuses/#create
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface MastodonReplyConfig {
  instance: string; // e.g. "mastodon.social"
  accessToken: string;
}

export async function sendMastodonOtp(
  cfg: MastodonReplyConfig,
  recipientHandle: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  // Strip leading @ if any; ensure handle has the form @user@instance for cross-instance DMs.
  const handle = recipientHandle.startsWith('@')
    ? recipientHandle
    : `@${recipientHandle}`;
  const url = `https://${cfg.instance}/api/v1/statuses`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.accessToken}`,
    },
    body: JSON.stringify({
      status: `${handle} ${otpMessageBody(code)}`,
      visibility: 'direct',
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'mastodon-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, status: res.status, messageId: data.id };
}
