// "Argentina just scored" — live in-match goal push for matches that
// affect the user's bracket. Match-window eligible (quiet-hours bypass).

import type { Bot } from "grammy";
import type { Storage } from "../storage.js";
import { dayKey, shouldSendPush } from "../rate-limit.js";
import type { PushResult } from "./market-move.js";

export interface GoalPush {
  user_id: string;
  team_name: string;
  scoreline: string;          // "ARG 2 - 0 FRA"
  match_id: string;
  bracket_signal: "your_pick_winning" | "your_pick_losing" | "neutral";
}

export async function sendGoalPush(
  bot: Bot,
  storage: Storage,
  push: GoalPush,
  now: Date = new Date(),
): Promise<PushResult> {
  const tgUser = storage.getUserByUserId(push.user_id);
  if (!tgUser) return { sent: false, reason: "no_telegram_link" };

  const decision = shouldSendPush({
    user: tgUser,
    category: "goal",
    now,
    in_match_window: true,
  });
  if (!decision.allow) return { sent: false, reason: decision.reason };

  let bracketLine = "";
  if (push.bracket_signal === "your_pick_winning") {
    bracketLine = "Your bracket's looking good.";
  } else if (push.bracket_signal === "your_pick_losing") {
    bracketLine = "Your bracket pick is in trouble.";
  }

  const text = [
    `${push.team_name} just scored — *${push.scoreline}*.`,
    bracketLine,
    `https://2026wc.tournamental.com/match/${push.match_id}`,
  ]
    .filter(Boolean)
    .join("\n");

  await bot.api.sendMessage(tgUser.chat_id, text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
  });
  storage.recordPush(tgUser.chat_id, now.getTime(), dayKey(now, tgUser.tz));
  return { sent: true };
}
