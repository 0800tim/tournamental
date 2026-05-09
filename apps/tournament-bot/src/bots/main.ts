// Main bot — `@VTournBot` (final username TBD). Wires grammY commands to
// the modular handlers in src/commands/.

import { Bot, type Context } from "grammy";
import type { Storage } from "../storage.js";
import { handleStart } from "../commands/start.js";
import { handlePicks } from "../commands/picks.js";
import { handleOdds } from "../commands/odds.js";
import { handleLeaderboard } from "../commands/leaderboard.js";
import { handleHelp } from "../commands/help.js";
import { handleSyndicate } from "../commands/syndicate.js";

export interface BotDeps {
  storage: Storage;
  // Override the HTTP client used by /odds and /leaderboard. In tests we
  // swap globalThis.fetch; in production we leave it undefined and the
  // commands fall back to the platform fetch.
  fetch?: typeof fetch;
}

export function createMainBot(token: string, deps: BotDeps): Bot {
  const bot = new Bot(token);

  bot.command("start", (ctx) => handleStart(ctx, deps));
  bot.command("picks", (ctx) => handlePicks(ctx, deps));
  bot.command("odds", (ctx) => handleOdds(ctx, deps));
  bot.command("leaderboard", (ctx) => handleLeaderboard(ctx, deps));
  bot.command("syndicate", (ctx) => handleSyndicate(ctx, deps));
  bot.command("help", (ctx) => handleHelp(ctx, deps));

  // Free-form text → polite nudge to use commands. Doc 13: "The bot
  // ignores free-form text outside of explicit flows."
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await ctx.reply(
      "Try /help to see what I can do. Free-form chat isn't wired up yet.",
    );
  });

  bot.catch((err) => {
    // grammY surfaces handler exceptions here. Re-throw in tests.
    // eslint-disable-next-line no-console
    console.error("[main-bot] handler error", err.error);
  });

  return bot;
}

export type AppContext = Context;
