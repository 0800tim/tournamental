// "Your match starts in 5 min" — fired ~5 minutes before kickoff for a
// match relevant to the user's bracket.

import type { Bot } from "grammy";
import type { Storage } from "../storage.js";
import { dayKey, shouldSendPush } from "../rate-limit.js";
import type { PushResult } from "./market-move.js";

export interface KickoffPush {
  user_id: string;
  match_label: string;        // "ARG vs FRA"
  user_pick: string | null;   // "Argentina to win" or null
  kickoff_iso: string;
  match_id: string;
}

export async function sendKickoffPush(
  bot: Bot,
  storage: Storage,
  push: KickoffPush,
  now: Date = new Date(),
): Promise<PushResult> {
  const tgUser = storage.getUserByUserId(push.user_id);
  if (!tgUser) return { sent: false, reason: "no_telegram_link" };

  // Kickoff push is "match-window" eligible — quiet-hours bypass.
  const decision = shouldSendPush({
    user: tgUser,
    category: "kickoff",
    now,
    in_match_window: true,
  });
  if (!decision.allow) return { sent: false, reason: decision.reason };

  const lines: string[] = [];
  lines.push(`*${push.match_label}* kicks off soon.`);
  if (push.user_pick) {
    lines.push(`Your pick: ${push.user_pick}.`);
  }
  lines.push(`Watch: https://play.tournamental.com/match/${push.match_id}`);

  await bot.api.sendMessage(tgUser.chat_id, lines.join("\n"), {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
  });
  storage.recordPush(tgUser.chat_id, now.getTime(), dayKey(now, tgUser.tz));
  return { sent: true };
}
