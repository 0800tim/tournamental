/**
 * Viber Bot API outbound reply adapter.
 *
 * https://developers.viber.com/docs/api/rest-bot-api/#send-message
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface ViberReplyConfig {
  authToken: string;
  senderName: string;
}

export async function sendViberOtp(
  cfg: ViberReplyConfig,
  receiverId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = 'https://chatapi.viber.com/pa/send_message';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Viber-Auth-Token': cfg.authToken,
    },
    body: JSON.stringify({
      receiver: receiverId,
      type: 'text',
      sender: { name: cfg.senderName },
      text: otpMessageBody(code),
      min_api_version: 1,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    status?: number;
    status_message?: string;
    message_token?: number | string;
  };
  if (!res.ok || data.status !== 0) {
    return {
      ok: false,
      status: res.status,
      detail: data.status_message ?? 'viber-send-failed',
    };
  }
  return {
    ok: true,
    status: res.status,
    messageId: data.message_token != null ? String(data.message_token) : undefined,
  };
}
