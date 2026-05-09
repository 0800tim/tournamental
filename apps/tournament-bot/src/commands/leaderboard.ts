// /leaderboard — fetch top + your rank from the api leaderboard endpoint.

import type { Context } from "grammy";
import type { BotDeps } from "../bots/main.js";

const LB_API_BASE =
  process.env.VTOURN_API_BASE ?? "https://api-dev.vtourn.com";

export async function handleLeaderboard(
  ctx: Context,
  deps: BotDeps,
): Promise<void> {
  if (!ctx.chat) return;
  const user = deps.storage.getUser(ctx.chat.id);
  const fetchImpl = deps.fetch ?? fetch;

  // Argument selects the scope: global | country | friends | week.
  const scope = (typeof ctx.match === "string" ? ctx.match : "")
    .trim()
    .toLowerCase() || "global";

  const url = `${LB_API_BASE}/v1/leaderboard/${encodeURIComponent(scope)}${
    user?.user_id ? `?for=${encodeURIComponent(user.user_id)}` : ""
  }`;

  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      await ctx.reply(
        `Leaderboard service is unhappy (HTTP ${res.status}). Try /leaderboard again shortly.`,
      );
      return;
    }
    const body = (await res.json()) as {
      scope: string;
      top: Array<{ rank: number; name: string; points: number }>;
      me?: { rank: number; points: number } | null;
    };
    const top = (body.top ?? []).slice(0, 10);
    const lines: string[] = [];
    lines.push(`*Leaderboard — ${body.scope ?? scope}*`);
    if (top.length === 0) {
      lines.push("_No entries yet — be the first to lock a pick._");
    } else {
      for (const row of top) {
        lines.push(`  ${row.rank}. ${row.name} — ${row.points.toLocaleString()} pts`);
      }
    }
    if (body.me) {
      lines.push(``);
      lines.push(
        `Your rank: *#${body.me.rank}* — ${body.me.points.toLocaleString()} pts`,
      );
    } else if (!user?.user_id) {
      lines.push(``);
      lines.push("_Pair your account with /start to see your rank._");
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(
      "Couldn't reach the leaderboard service. Try again in a moment.",
    );
    // eslint-disable-next-line no-console
    console.warn("[leaderboard] fetch failed", err);
  }
}
