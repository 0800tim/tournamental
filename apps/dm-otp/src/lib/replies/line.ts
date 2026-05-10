/**
 * LINE Messaging API outbound reply adapter.
 *
 * https://developers.line.biz/en/reference/messaging-api/#send-push-message
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface LineReplyConfig {
  channelAccessToken: string;
}

export async function sendLineOtp(
  cfg: LineReplyConfig,
  toUserId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = 'https://api.line.me/v2/bot/message/push';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.channelAccessToken}`,
    },
    body: JSON.stringify({
      to: toUserId,
      messages: [{ type: 'text', text: otpMessageBody(code) }],
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'line-send-failed' };
  }
  return { ok: true, status: res.status };
}
