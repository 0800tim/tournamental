/**
 * Telegram reply adapter.
 *
 * Uses the Bot API sendMessage endpoint:
 *   https://api.telegram.org/bot<token>/sendMessage
 *   body: { chat_id, text }
 *
 * Telegram has no 24-hour-window restriction for bots: as long as the
 * user has DM'd us first (which they have, by sending "log in"), we can
 * reply freely. See https://core.telegram.org/bots/api#sendmessage.
 */

import type { ReplyAdapter, ReplyResult, SendSeam } from './types.js';
import { realFetchSeam } from './types.js';

export interface TelegramReplyConfig {
  botToken: string;
  /** Override the API base for self-hosted bot servers; defaults to the public API. */
  apiBase?: string;
  _send?: SendSeam;
}

export class TelegramReply implements ReplyAdapter {
  channel = 'telegram' as const;
  private readonly botToken: string;
  private readonly apiBase: string;
  private readonly send: SendSeam;

  constructor(cfg: TelegramReplyConfig) {
    if (!cfg.botToken) throw new Error('TelegramReply: botToken required');
    this.botToken = cfg.botToken;
    this.apiBase = (cfg.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
    this.send = cfg._send ?? realFetchSeam;
  }

  async reply(externalId: string, message: string): Promise<ReplyResult> {
    const url = `${this.apiBase}/bot${this.botToken}/sendMessage`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: externalId, text: message }),
    };
    try {
      const res = await this.send({ url, init });
      if (!res.ok) {
        return {
          ok: false,
          errorCode: `http-${res.status}`,
          errorMessage: res.bodyText.slice(0, 200),
        };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errorCode: 'network',
        errorMessage: err instanceof Error ? err.message : 'telegram send failed',
      };
    }
  }
}
