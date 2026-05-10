// /start — onboard the user, link the chat to a user_id, and route into
// syndicate / invite / login deep-link payloads when present.

import type { Context } from "grammy";
import type { BotDeps } from "../bots/main.js";
import { parseStartPayload } from "../bots/syndicate-factory.js";

export async function handleStart(ctx: Context, deps: BotDeps): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return;

  const from = ctx.from;
  const lang = from?.language_code ?? null;

  // grammY surfaces the deep-link payload in ctx.match for /start.
  const rawMatch =
    typeof ctx.match === "string"
      ? ctx.match
      : Array.isArray(ctx.match)
        ? ctx.match[0]
        : "";
  const payload = parseStartPayload(rawMatch || undefined);

  // Persist (or refresh) the user row so we have a chat_id ↔ user_id
  // mapping for future pushes. user_id stays null until they finish
  // web-side OTC pairing.
  deps.storage.upsertUser({
    chat_id: chat.id,
    language_code: lang,
  });

  if (payload.kind === "syndicate" && payload.value) {
    const syn = deps.storage.getSyndicateBySlug(payload.value);
    if (!syn) {
      await ctx.reply(
        `Welcome. I couldn't find a syndicate with slug "${payload.value}". ` +
          "Check the invite link with whoever shared it.",
      );
      return;
    }
    await ctx.reply(
      [
        `Welcome to *${syn.name}* — Tournamental syndicate.`,
        ``,
        `Format: ${formatLabel(syn.format)}`,
        `Privacy: ${syn.privacy === "invite_only" ? "invite-only" : "public"}`,
        ``,
        `Tap /picks to see your bracket, /leaderboard to see where the syndicate stands, /help for the rest.`,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (payload.kind === "login" && payload.value) {
    // Web-flow OTC. The web app posted an `otc:<code>` row to Redis.
    // Production wires this into the auth service; for v0 we acknowledge
    // and the auth service polls back.
    await ctx.reply(
      `Logging you in... (code ${payload.value}). Head back to the web tab — it'll update in a sec.`,
    );
    return;
  }

  if (payload.kind === "invite" && payload.value) {
    await ctx.reply(
      `Welcome — you were invited by user ${payload.value}. Tap /picks to make your first bracket pick.`,
    );
    return;
  }

  await ctx.reply(
    [
      "Welcome to *Tournamental* — the never-finished bracket game.",
      "",
      "Commands:",
      "  /picks — see your bracket",
      "  /odds team:argentina — current market probability",
      "  /leaderboard — your rank",
      "  /syndicate — manage your syndicate",
      "  /help — full command list",
      "",
      "Tap /picks to start.",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
}

function formatLabel(f: string): string {
  switch (f) {
    case "winner_take_all":
      return "winner takes all";
    case "podium":
      return "top 3 share";
    case "points":
      return "points league";
    default:
      return f;
  }
}
