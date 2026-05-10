/**
 * X (Twitter) DM outbound reply adapter.
 *
 * Requires X API Pro tier. Account Activity API delivers inbound DMs
 * to a webhook; we reply via v2 DM messages endpoint.
 *
 * https://developer.x.com/en/docs/x-api/direct-messages/manage-direct-messages/api-reference/post-dm_conversations-with-participant_id-messages
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface XReplyConfig {
  bearerToken: string;
}

export async function sendXOtp(
  cfg: XReplyConfig,
  recipientUserId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = `https://api.twitter.com/2/dm_conversations/with/${recipientUserId}/messages`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.bearerToken}`,
    },
    body: JSON.stringify({ text: otpMessageBody(code) }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'x-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    data?: { dm_event_id?: string };
  };
  return { ok: true, status: res.status, messageId: data.data?.dm_event_id };
}
