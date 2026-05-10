/**
 * Telegram bot sink — sends to a chat via the Bot API.
 *
 * Env:
 *   SECURITY_TELEGRAM_BOT_TOKEN
 *   SECURITY_TELEGRAM_CHAT_ID
 */

import type { Finding } from '../lib/types.js';
import type { AlertSink } from './index.js';

export interface TelegramSinkOptions {
  botToken?: string;
  chatId?: string;
  fetchImpl?: typeof fetch;
}

export function buildTelegramSink(opts: TelegramSinkOptions = {}): AlertSink {
  const botToken = opts.botToken ?? process.env.SECURITY_TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId ?? process.env.SECURITY_TELEGRAM_CHAT_ID;
  const enabled = !!botToken && !!chatId;
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: 'telegram',
    enabled,
    async deliver(f: Finding) {
      if (!enabled || !botToken || !chatId) return;
      const text = [
        `[${f.severity.toUpperCase()}] ${f.source}: ${f.title}`,
        f.location ? `Location: ${f.location}` : '',
        f.detail ?? '',
        `ID: ${f.id}`,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 3500);
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        throw new Error(`telegram api ${res.status}`);
      }
    },
  };
}
