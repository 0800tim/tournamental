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
import type { WhatsAppPushSender } from './whatsapp.js';

export type NotifyEvent =
  | 'kickoff_soon'
  | 'match_result'
  | 'leaderboard_move';

/**
 * Channel-preference policy for users who have linked both WhatsApp and SMS.
 *
 *   auto      WhatsApp wins when both are linked (cheaper + higher open
 *             rate). Falls back to SMS when only SMS is linked. Default.
 *   whatsapp  WhatsApp only — never send SMS even if only SMS is linked.
 *   sms       SMS only — never send WhatsApp even if only WA is linked.
 *
 * Web Push and Telegram are unaffected by this policy: they fan out to
 * every user who has subscribed.
 */
export type PreferredChannel = 'auto' | 'whatsapp' | 'sms';

export interface DispatcherConfig {
  store: SubscriptionStore;
  webPush: StubWebPushSender;
  telegram: StubTelegramSender;
  sms: StubSmsSender;
  whatsapp: WhatsAppPushSender;
  /** SMS↔WhatsApp policy. Defaults to 'auto'. */
  preferredChannel?: PreferredChannel;
}

export interface FanOutResult {
  userId: string;
  webPush?: 'sent' | 'skipped' | 'failed';
  telegram?: 'sent' | 'skipped' | 'failed';
  sms?: 'sent' | 'skipped' | 'failed' | 'suppressed';
  whatsapp?: 'sent' | 'skipped' | 'failed' | 'suppressed';
}

/** Plain-text body for SMS, plus a Markdown body for Telegram, plus a
 * structured payload for Web Push, plus a WhatsApp body that may include a
 * tappable URL. We render once and adapt per channel. */
export interface NotificationContent {
  webPush: { title: string; body: string; url?: string; tag?: string };
  telegram: { body: string; url?: string };
  sms: { body: string };
  whatsapp: { body: string; url?: string };
}

export class Dispatcher {
  constructor(private readonly cfg: DispatcherConfig) {}

  /** Resolve which of {WhatsApp, SMS} should fire, given the user's linked
   * channels and the configured policy.
   *
   * | policy   | wa linked | sms linked | wa fires | sms fires |
   * | -------- | --------- | ---------- | -------- | --------- |
   * | auto     | yes       | yes        |   yes    |    no     |
   * | auto     | yes       | no         |   yes    |    no     |
   * | auto     | no        | yes        |   no     |    yes    |
   * | whatsapp | yes       | yes/no     |   yes    |    no     |
   * | whatsapp | no        | yes        |   no     |    no     |
   * | sms      | yes/no    | yes        |   no     |    yes    |
   * | sms      | yes       | no         |   no     |    no     |
   */
  private resolveSmsWa(userId: string): {
    sendWa: boolean;
    sendSms: boolean;
    waSuppressed: boolean;
    smsSuppressed: boolean;
  } {
    const policy: PreferredChannel = this.cfg.preferredChannel ?? 'auto';
    const wa = this.cfg.store.getWhatsApp(userId);
    const sms = this.cfg.store.getSms(userId);
    if (policy === 'whatsapp') {
      return {
        sendWa: Boolean(wa),
        sendSms: false,
        waSuppressed: false,
        smsSuppressed: Boolean(sms),
      };
    }
    if (policy === 'sms') {
      return {
        sendWa: false,
        sendSms: Boolean(sms),
        waSuppressed: Boolean(wa),
        smsSuppressed: false,
      };
    }
    // auto — WhatsApp wins when present.
    if (wa) {
      return {
        sendWa: true,
        sendSms: false,
        waSuppressed: false,
        smsSuppressed: Boolean(sms),
      };
    }
    return {
      sendWa: false,
      sendSms: Boolean(sms),
      waSuppressed: false,
      smsSuppressed: false,
    };
  }

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

    const route = this.resolveSmsWa(userId);

    if (route.sendWa) {
      const wa = this.cfg.store.getWhatsApp(userId);
      if (wa) {
        const r = await this.cfg.whatsapp.send(
          userId,
          wa.phone,
          content.whatsapp,
          event,
        );
        result.whatsapp = r.ok ? 'sent' : 'failed';
      } else {
        result.whatsapp = 'skipped';
      }
    } else if (route.waSuppressed) {
      result.whatsapp = 'suppressed';
    } else {
      result.whatsapp = 'skipped';
    }

    if (route.sendSms) {
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
    } else if (route.smsSuppressed) {
      result.sms = 'suppressed';
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
      whatsapp: { body: `${title}\n${body}`, url },
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
      whatsapp: { body: `${title} +${points} pts. ${body}`, url },
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
      whatsapp: { body: `${title}\n${body}`, url },
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
      whatsapp: { body: `${title}\n${body}`, url },
    };
  }
}
