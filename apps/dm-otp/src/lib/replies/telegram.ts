/**
 * Telegram outbound reply adapter.
 *
 * https://core.telegram.org/bots/api#sendmessage
 */

import { otpMessageBody, type AdapterDeps, type ReplyResult } from './types.js';

export interface TelegramReplyConfig {
  botToken: string;
}

export async function sendTelegramOtp(
  cfg: TelegramReplyConfig,
  chatId: string,
  code: string,
  deps: AdapterDeps = {},
): Promise<ReplyResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: otpMessageBody(code),
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: 'telegram-send-failed' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    result?: { message_id?: number };
  };
  return {
    ok: true,
    status: res.status,
    messageId: data.result?.message_id ? String(data.result.message_id) : undefined,
  };
}
