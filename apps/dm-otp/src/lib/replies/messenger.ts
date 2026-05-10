/**
 * Messenger (Meta Pages) outbound reply adapter.
 *
 * https://developers.facebook.com/docs/messenger-platform/send-messages
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface MessengerReplyConfig {
  pageAccessToken: string;
  graphVersion?: string;
}

export async function sendMessengerOtp(
  cfg: MessengerReplyConfig,
  psid: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const v = cfg.graphVersion ?? 'v20.0';
  const url = `https://graph.facebook.com/${v}/me/messages?access_token=${encodeURIComponent(cfg.pageAccessToken)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text: otpMessageBody(code) },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'messenger-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
  };
  return { ok: true, status: res.status, messageId: data.message_id };
}
