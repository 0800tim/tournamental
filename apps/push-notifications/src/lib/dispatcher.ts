/**
 * Multi-channel dispatcher.
 *
 * One entry point per notification type. Each pulls the user's active
 * subscriptions out of the store and fans the rendered payload out to
 * every channel the user has opted in to. Adapters never throw — they
 * record the audit log and return ok:false on failure.
 */

import type { SubscriptionStore } from './subscriptions.js';
import type { StubWebPushSender } from './web-push.js';
import type { StubTelegramSender } from './telegram.js';
import type { StubSmsSender } from './sms.js';

export type NotifyEvent =
  | 'kickoff_soon'
  | 'match_result'
  | 'leaderboard_move';

export interface DispatcherConfig {
  store: SubscriptionStore;
  webPush: StubWebPushSender;
  telegram: StubTelegramSender;
  sms: StubSmsSender;
}

export interface FanOutResult {
  userId: string;
  webPush?: 'sent' | 'skipped' | 'failed';
  telegram?: 'sent' | 'skipped' | 'failed';
  sms?: 'sent' | 'skipped' | 'failed';
}

/** Plain-text body for SMS, plus a Markdown body for Telegram, plus a
 * structured payload for Web Push. We render once and adapt per channel. */
export interface NotificationContent {
  webPush: { title: string; body: string; url?: string; tag?: string };
  telegram: { body: string; url?: string };
  sms: { body: string };
}

export class Dispatcher {
  constructor(private readonly cfg: DispatcherConfig) {}

  async fanOut(
    userId: string,
    event: NotifyEvent,
    content: NotificationContent,
  ): Promise<FanOutResult> {
    const result: FanOutResult = { userId };

    const wp = this.cfg.store.getWebPush(userId);
    if (wp) {
      const r = await this.cfg.webPush.send(
        userId,
        wp.subscription,
        content.webPush,
        event,
      );
      result.webPush = r.ok ? 'sent' : 'failed';
    } else {
      result.webPush = 'skipped';
    }

    const tg = this.cfg.store.getTelegram(userId);
    if (tg) {
      const r = await this.cfg.telegram.send(
        userId,
        tg.telegramUserId,
        content.telegram,
        event,
      );
      result.telegram = r.ok ? 'sent' : 'failed';
    } else {
      result.telegram = 'skipped';
    }

    const sms = this.cfg.store.getSms(userId);
    if (sms) {
      const r = await this.cfg.sms.send(
        userId,
        sms.phone,
        content.sms,
        event,
      );
      result.sms = r.ok ? 'sent' : 'failed';
    } else {
      result.sms = 'skipped';
    }

    return result;
  }

  // ---------- content rendering helpers ----------

  static renderKickoff(matchId: string, minutesUntil: number): NotificationContent {
    const title = `Kickoff in ${minutesUntil} min`;
    const body = `Your match (${matchId}) starts in ${minutesUntil} minutes.`;
    const url = `https://vtourn.com/match/${matchId}`;
    return {
      webPush: { title, body, url, tag: `kickoff:${matchId}` },
      telegram: { body: `*${title}* — ${body}`, url },
      sms: { body: `${title}: match ${matchId}. ${url}` },
    };
  }

  static renderMatchResultWin(
    matchId: string,
    points: number,
    scoreboard?: string,
  ): NotificationContent {
    const title = 'You got it right!';
    const body = scoreboard
      ? `Match ${matchId} ended ${scoreboard}. +${points} pts.`
      : `Match ${matchId} settled. +${points} pts.`;
    const url = `https://vtourn.com/match/${matchId}`;
    return {
      webPush: { title, body, url, tag: `result:${matchId}` },
      telegram: { body: `*${title}* +${points} pts. ${body}`, url },
      sms: { body: `${title} +${points} pts on match ${matchId}.` },
    };
  }

  static renderMatchResultLoss(
    matchId: string,
    scoreboard?: string,
  ): NotificationContent {
    const title = 'Tough luck';
    const body = scoreboard
      ? `Match ${matchId} ended ${scoreboard}. Better next time.`
      : `Match ${matchId} settled. Better next time.`;
    const url = `https://vtourn.com/match/${matchId}`;
    return {
      webPush: { title, body, url, tag: `result:${matchId}` },
      telegram: { body: `*${title}* — ${body}`, url },
      sms: { body: `${title}: match ${matchId} didn't go your way.` },
    };
  }

  static renderLeaderboardMove(
    fromRank: number,
    toRank: number,
    tournamentId: string,
  ): NotificationContent {
    const delta = fromRank - toRank;
    const title = `You jumped ${delta} places!`;
    const body = `You moved from #${fromRank} to #${toRank} on the ${tournamentId} leaderboard.`;
    const url = `https://vtourn.com/t/${tournamentId}/leaderboard`;
    return {
      webPush: { title, body, url, tag: `lb:${tournamentId}` },
      telegram: { body: `*${title}* — ${body}`, url },
      sms: { body: `${title} ${body}` },
    };
  }
}
