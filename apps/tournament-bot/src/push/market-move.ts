// "Your pick X dropped 8pp" — fired when Polymarket implied prob for a
// team the user picked moves more than ±5pp (per docs/30 § Push system).

import type { Bot } from "grammy";
import type { Storage } from "../storage.js";
import { dayKey, shouldSendPush } from "../rate-limit.js";

export interface MarketMovePush {
  user_id: string;
  team_name: string;
  old_pp: number;
  new_pp: number;
  // Pick id so the inline button can deep-link to the pick page.
  pick_id?: string;
}

export interface PushResult {
  sent: boolean;
  reason?: string;
}

export async function sendMarketMovePush(
  bot: Bot,
  storage: Storage,
  push: MarketMovePush,
  now: Date = new Date(),
): Promise<PushResult> {
  const tgUser = storage.getUserByUserId(push.user_id);
  if (!tgUser) return { sent: false, reason: "no_telegram_link" };

  const decision = shouldSendPush({
    user: tgUser,
    category: "market_move",
    now,
    in_match_window: false,
  });
  if (!decision.allow) return { sent: false, reason: decision.reason };

  const delta = push.new_pp - push.old_pp;
  const arrow = delta < 0 ? "dropped" : "climbed";
  const text =
    `Heads up — your pick *${push.team_name}* just ${arrow} ` +
    `from ${formatPp(push.old_pp)} to ${formatPp(push.new_pp)} on the market. ` +
    (delta < 0 ? "Change pick?" : "Doubling down?");

  await bot.api.sendMessage(tgUser.chat_id, text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
  });
  storage.recordPush(tgUser.chat_id, now.getTime(), dayKey(now, tgUser.tz));
  return { sent: true };
}

function formatPp(pp: number): string {
  return `${(pp * 100).toFixed(0)}%`;
}
