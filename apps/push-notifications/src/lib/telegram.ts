/**
 * Telegram channel adapter.
 *
 * Stubbed for v0.1 — we never actually call the Bot API. A real
 * implementation would either:
 *   1. Import grammY and call `bot.api.sendMessage(chatId, body, opts)`
 *      directly using `TELEGRAM_BOT_TOKEN`, mirroring the existing helper
 *      at apps/tournament-bot/src/push/kickoff.ts.
 *   2. POST to the tournament-bot's internal push endpoint, so all
 *      Telegram delivery flows through one bot process (preferred — keeps
 *      one rate-limit budget per BotFather token).
 *
 * Env required for production:
 *   TELEGRAM_BOT_TOKEN          BotFather token (option 1)
 *   TOURNAMENT_BOT_PUSH_URL     internal URL of tournament-bot (option 2)
 *   TOURNAMENT_BOT_PUSH_SECRET  shared secret for option 2
 */

import type { AuditLogger } from './audit.js';

export interface TelegramPayload {
  /** Pre-rendered message body. Markdown-escaped by the caller. */
  body: string;
  /** Optional URL appended as a tappable link. */
  url?: string;
}

export interface TelegramResult {
  ok: boolean;
  errorMessage?: string;
}

export interface TelegramSenderConfig {
  audit: AuditLogger;
  botToken?: string;
  pushUrl?: string;
  pushSecret?: string;
}

export class StubTelegramSender {
  constructor(private readonly cfg: TelegramSenderConfig) {}

  async send(
    userId: string,
    telegramUserId: string,
    payload: TelegramPayload,
    event: 'kickoff_soon' | 'match_result' | 'leaderboard_move',
  ): Promise<TelegramResult> {
    const configured = Boolean(this.cfg.botToken || this.cfg.pushUrl);
    await this.cfg.audit.append({
      channel: 'telegram',
      userId,
      event,
      payload: {
        telegramUserId,
        body: payload.body,
        url: payload.url,
      },
      ok: true,
      note: configured
        ? 'stub: bot configured but real send is not wired in v0.1'
        : 'stub: TELEGRAM_BOT_TOKEN not configured; would skip in prod',
    });
    return { ok: true };
  }
}
