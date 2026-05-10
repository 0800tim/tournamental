// /odds team:argentina — fetch current Polymarket implied prob from
// `apps/api`'s odds proxy. Falls back to a polite "couldn't fetch" if the
// odds service is unreachable.

import type { Context } from "grammy";
import type { BotDeps } from "../bots/main.js";

const ODDS_API_BASE =
  process.env.TOURNAMENTAL_ODDS_API_BASE ?? "https://api-dev.tournamental.com";

export async function handleOdds(ctx: Context, deps: BotDeps): Promise<void> {
  const text = ctx.message?.text ?? "";
  // grammY's ctx.match for /odds gives the bit after the command.
  const arg =
    typeof ctx.match === "string" && ctx.match.length > 0
      ? ctx.match
      : text.replace(/^\/odds(@\S+)?\s*/i, "").trim();

  if (!arg) {
    await ctx.reply(
      "Usage: /odds team:argentina — current Polymarket probability for a team.",
    );
    return;
  }

  const team = parseTeamArg(arg);
  if (!team) {
    await ctx.reply(
      `Couldn't read "${arg}". Try /odds team:argentina or /odds team:france.`,
    );
    return;
  }

  const fetchImpl = deps.fetch ?? fetch;
  try {
    const res = await fetchImpl(
      `${ODDS_API_BASE}/v1/odds/team/${encodeURIComponent(team)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) {
      await ctx.reply(
        `Couldn't fetch odds for ${team} right now (HTTP ${res.status}). Try again in a moment.`,
      );
      return;
    }
    const body = (await res.json()) as {
      team_code?: string;
      team_name?: string;
      prob_to_win_group?: number;
      prob_to_win_tournament?: number;
      market_url?: string;
    };
    const lines: string[] = [];
    lines.push(`*${body.team_name ?? team}*`);
    if (typeof body.prob_to_win_group === "number") {
      lines.push(
        `  Win group: ${(body.prob_to_win_group * 100).toFixed(1)}%`,
      );
    }
    if (typeof body.prob_to_win_tournament === "number") {
      lines.push(
        `  Win tournament: ${(body.prob_to_win_tournament * 100).toFixed(1)}%`,
      );
    }
    if (lines.length === 1) {
      lines.push("  No live market data — try again closer to kickoff.");
    }
    await ctx.reply(lines.join("\n"), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    await ctx.reply(
      `Couldn't reach the odds service right now. Try again in a moment.`,
    );
    // eslint-disable-next-line no-console
    console.warn("[odds] fetch failed", err);
  }
}

export function parseTeamArg(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  // Accept either `team:argentina` or just `argentina`.
  const m = trimmed.match(/^(?:team:)?([a-z][a-z0-9-]{1,32})$/);
  return m ? m[1] : null;
}
