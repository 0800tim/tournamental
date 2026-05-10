// /picks — show the user's current bracket. v0 stub: links to the web app
// because the bracket UI on Telegram is a doc-13 follow-up (mini-app /
// inline keyboard tree). Production wires to /v1/users/:id/bracket.

import type { Context } from "grammy";
import type { BotDeps } from "../bots/main.js";

const BRACKET_BASE_URL =
  process.env.TOURNAMENTAL_BRACKET_BASE_URL ?? "https://2026wc.tournamental.com";

export async function handlePicks(ctx: Context, deps: BotDeps): Promise<void> {
  if (!ctx.chat) return;
  const user = deps.storage.getUser(ctx.chat.id);

  if (!user || !user.user_id) {
    await ctx.reply(
      [
        "You're not paired with a Tournamental account yet.",
        "",
        `Open ${BRACKET_BASE_URL} and tap "Sign in with Telegram", or run /start to get a fresh code.`,
      ].join("\n"),
    );
    return;
  }

  // Production: GET /v1/users/:user_id/bracket and render a compact summary.
  // For v0 we deep-link back to the web bracket so the mini-app loads with
  // the user already authed.
  await ctx.reply(
    [
      "Your bracket — open in the app:",
      `${BRACKET_BASE_URL}/u/${user.user_id}/bracket`,
      "",
      "Once the inline-keyboard pick flow ships (doc 13 § Bot commands), you'll be able to lock picks here without leaving Telegram.",
    ].join("\n"),
    { link_preview_options: { is_disabled: true } },
  );
}
