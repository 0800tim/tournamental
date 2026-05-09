// /help — list commands. Mirrors the BotFather /setcommands list in the README.

import type { Context } from "grammy";
import type { BotDeps } from "../bots/main.js";

export async function handleHelp(ctx: Context, _deps: BotDeps): Promise<void> {
  await ctx.reply(
    [
      "*VTourn — command list*",
      "",
      "  /start — connect your bracket / accept a syndicate invite",
      "  /picks — view your bracket",
      "  /odds team:argentina — live market probability",
      "  /leaderboard — your rank (global by default; pass `country`, `week`, `friends`)",
      "  /syndicate create <slug> <name> — start a private league",
      "  /syndicate join <slug> — join an existing league",
      "  /syndicate leave <slug> — leave",
      "  /syndicate list — your leagues",
      "  /help — this message",
      "",
      "Notification prefs are managed in-app (settings → notifications). The bot honours quiet hours (default 22:00–08:00 in your timezone) and a 3-push-per-day cap unless you enable match-day mode.",
    ].join("\n"),
    {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    },
  );
}
