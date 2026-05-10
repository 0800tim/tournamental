// Main bot — `@TournamentalBot` (final username TBD). Wires grammY commands to
// the cross-platform dispatcher in `lib/dispatch.ts`.
//
// The grammY layer is now a thin transport adapter: it normalises an
// incoming Telegram update into a `dispatch()` call and renders the
// returned `DispatchReply`s back through `ctx.reply`. The same dispatcher
// runs WhatsApp via the Aiva gateway (see `whatsapp/handler.ts`), so any
// command-logic change happens once.

import { Bot, type Context } from "grammy";
import type { Storage } from "../storage.js";
import { dispatch } from "../lib/dispatch.js";

export interface BotDeps {
  storage: Storage;
  // Override the HTTP client used by /odds and /leaderboard. In tests we
  // swap globalThis.fetch; in production we leave it undefined and the
  // commands fall back to the platform fetch.
  fetch?: typeof fetch;
}

export function createMainBot(token: string, deps: BotDeps): Bot {
  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    if (!ctx.chat) return;
    const replies = await dispatch(
      {
        source: "telegram",
        sourceId: ctx.chat.id,
        text: ctx.message.text,
        languageCode: ctx.from?.language_code ?? null,
        botUsername: ctx.me.username,
      },
      { storage: deps.storage, fetch: deps.fetch },
    );
    for (const r of replies) {
      await ctx.reply(r.text, {
        parse_mode: r.parseMode,
        link_preview_options: r.disableLinkPreview
          ? { is_disabled: true }
          : undefined,
      });
    }
  });

  bot.catch((err) => {
    // grammY surfaces handler exceptions here.
    // eslint-disable-next-line no-console
    console.error("[main-bot] handler error", err.error);
  });

  return bot;
}

export type AppContext = Context;
