// /syndicate create | join | leave | list — manage syndicate membership
// for the user behind the chat.
//
// Slugs are user-supplied and validated against /^[a-z0-9-]{2,40}$/.
// Names are free-form up to 80 chars, stripped of control chars.

import type { Context } from "grammy";
import type { BotDeps } from "../bots/main.js";

const SLUG_RE = /^[a-z0-9-]{2,40}$/;

export async function handleSyndicate(
  ctx: Context,
  deps: BotDeps,
): Promise<void> {
  if (!ctx.chat) return;
  const user = deps.storage.getUser(ctx.chat.id);

  const argline =
    (typeof ctx.match === "string" ? ctx.match : "").trim() ||
    (ctx.message?.text ?? "").replace(/^\/syndicate(@\S+)?\s*/i, "").trim();

  if (!argline) {
    await ctx.reply(
      [
        "Syndicate commands:",
        "  /syndicate create <slug> <name>",
        "  /syndicate join <slug>",
        "  /syndicate leave <slug>",
        "  /syndicate list",
      ].join("\n"),
    );
    return;
  }

  const tokens = argline.split(/\s+/);
  const sub = tokens[0]?.toLowerCase();

  if (sub === "list") {
    if (!user?.user_id) {
      await ctx.reply("Pair your account first with /start.");
      return;
    }
    const memberships = deps.storage.listMemberships(user.user_id);
    if (memberships.length === 0) {
      await ctx.reply("You're not in any syndicates yet. Try `/syndicate create <slug> <name>`.");
      return;
    }
    const lines = memberships.map(
      (s) => `  • *${s.name}* (\`${s.slug}\`) — ${s.privacy}`,
    );
    await ctx.reply(["*Your syndicates*", ...lines].join("\n"), {
      parse_mode: "Markdown",
    });
    return;
  }

  if (sub === "create") {
    if (!user?.user_id) {
      await ctx.reply("Pair your account first with /start.");
      return;
    }
    const rawSlug = tokens[1] ?? "";
    const name = tokens.slice(2).join(" ").slice(0, 80).trim();
    if (!SLUG_RE.test(rawSlug)) {
      await ctx.reply(
        "Slug must be 2–40 lowercase letters, digits, or dashes. Example: `jasons-office`.",
      );
      return;
    }
    const slug = rawSlug;
    if (!name) {
      await ctx.reply("Give it a name. Example: `/syndicate create jasons-office Jason's Office Sweepstakes`");
      return;
    }
    const existing = deps.storage.getSyndicateBySlug(slug);
    if (existing) {
      await ctx.reply(`Slug \`${slug}\` is taken. Try another.`, {
        parse_mode: "Markdown",
      });
      return;
    }
    const id = `syn_${slug}_${Date.now().toString(36)}`;
    const created = deps.storage.createSyndicate({
      id,
      slug,
      name,
      owner_user_id: user.user_id,
      format: "points",
      privacy: "invite_only",
    });
    await ctx.reply(
      [
        `*${created.name}* created.`,
        `Invite link: https://t.me/${ctx.me.username}?start=syn_${created.slug}`,
        ``,
        `Default format is "points league" and privacy "invite-only" — change in the web app.`,
      ].join("\n"),
      {
        parse_mode: "Markdown",
        link_preview_options: { is_disabled: true },
      },
    );
    return;
  }

  if (sub === "join") {
    if (!user?.user_id) {
      await ctx.reply("Pair your account first with /start.");
      return;
    }
    const slug = tokens[1]?.toLowerCase() ?? "";
    if (!SLUG_RE.test(slug)) {
      await ctx.reply("Usage: `/syndicate join <slug>`", { parse_mode: "Markdown" });
      return;
    }
    const syn = deps.storage.getSyndicateBySlug(slug);
    if (!syn) {
      await ctx.reply(`No syndicate with slug \`${slug}\`.`, {
        parse_mode: "Markdown",
      });
      return;
    }
    deps.storage.addMember(syn.id, user.user_id, "member");
    await ctx.reply(`Joined *${syn.name}*. /leaderboard ${syn.slug} to see standings.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (sub === "leave") {
    if (!user?.user_id) {
      await ctx.reply("Pair your account first with /start.");
      return;
    }
    const slug = tokens[1]?.toLowerCase() ?? "";
    const syn = deps.storage.getSyndicateBySlug(slug);
    if (!syn) {
      await ctx.reply(`No syndicate with slug \`${slug}\`.`, {
        parse_mode: "Markdown",
      });
      return;
    }
    deps.storage.removeMember(syn.id, user.user_id);
    await ctx.reply(`Left *${syn.name}*.`, { parse_mode: "Markdown" });
    return;
  }

  await ctx.reply(
    "Unknown sub-command. Try /syndicate (no args) for the help list.",
  );
}
