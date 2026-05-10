/**
 * Slack outbound reply adapter.
 *
 * https://api.slack.com/methods/chat.postMessage
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface SlackReplyConfig {
  botToken: string;
}

export async function sendSlackOtp(
  cfg: SlackReplyConfig,
  channelOrUserId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = 'https://slack.com/api/chat.postMessage';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${cfg.botToken}`,
    },
    body: JSON.stringify({
      channel: channelOrUserId,
      text: otpMessageBody(code),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    ts?: string;
  };
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      status: res.status,
      detail: data.error ?? 'slack-send-failed',
    };
  }
  return { ok: true, status: res.status, messageId: data.ts };
}
