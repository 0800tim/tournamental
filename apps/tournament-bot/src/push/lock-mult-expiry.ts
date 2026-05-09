// "{team} multiplier expires in 24h" — fired when the early-lock multiplier
// is about to drop a band (5.0× → 4.0× → 3.0× → 2.0× → 1.0×).

import type { Bot } from "grammy";
import type { Storage } from "../storage.js";
import { dayKey, shouldSendPush } from "../rate-limit.js";
import type { PushResult } from "./market-move.js";

export interface LockMultExpiryPush {
  user_id: string;
  team_name: string;
  current_mult: number;
  hours_until_drop: number;
}

export async function sendLockMultExpiryPush(
  bot: Bot,
  storage: Storage,
  push: LockMultExpiryPush,
  now: Date = new Date(),
): Promise<PushResult> {
  const tgUser = storage.getUserByUserId(push.user_id);
  if (!tgUser) return { sent: false, reason: "no_telegram_link" };

  const decision = shouldSendPush({
    user: tgUser,
    category: "lock_mult_expiry",
    now,
    in_match_window: false,
  });
  if (!decision.allow) return { sent: false, reason: decision.reason };

  const hours = Math.max(1, Math.round(push.hours_until_drop));
  const text =
    `*${push.team_name}* multiplier expires in ${hours}h. ` +
    `Lock now to keep ${push.current_mult.toFixed(1)}× on this pick.`;

  await bot.api.sendMessage(tgUser.chat_id, text, { parse_mode: "Markdown" });
  storage.recordPush(tgUser.chat_id, now.getTime(), dayKey(now, tgUser.tz));
  return { sent: true };
}
