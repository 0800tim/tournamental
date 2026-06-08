/**
 * Sage main entrypoint.
 *
 * Runs a single decision pass and exits. PM2 wakes us every 6 hours via
 * `cron_restart` (see ecosystem.config.cjs). One pass = fetch the match
 * catalogue, fetch the live odds snapshot, ask Claude for a pick per
 * upcoming match, flush as one bulk submission via @tournamental/bot-sdk.
 *
 * Exit codes:
 *   0 normal: registered, picked, flushed.
 *   2 config error (missing API keys).
 *   3 transient error (network, API non-200); PM2 will retry on next cron tick.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §9.
 * Plan: docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md Task 20.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Bot } from "@tournamental/bot-sdk";

import { fetchMatches, fetchOddsSnapshot, selectUpcoming, DEFAULT_TOURNAMENT_ID } from "./api.js";
import { ensureSageRegistered, SAGE_HANDLE } from "./register.js";
import { decide, DEFAULT_MODEL } from "./strategy.js";

interface Env {
  ANTHROPIC_API_KEY: string;
  TOURNAMENTAL_API_KEY: string;
  TOURNAMENTAL_API_BASE?: string;
  ODDS_API_BASE?: string;
  TOURNAMENT_ID?: string;
  SAGE_MAX_PICKS?: string;
  SAGE_MODEL?: string;
}

function readEnv(): Env | null {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!anthropic || !apiKey) {
    console.error(
      "sage: missing required env. Need ANTHROPIC_API_KEY and TOURNAMENTAL_API_KEY.",
    );
    return null;
  }
  return {
    ANTHROPIC_API_KEY: anthropic,
    TOURNAMENTAL_API_KEY: apiKey,
    TOURNAMENTAL_API_BASE: process.env.TOURNAMENTAL_API_BASE,
    ODDS_API_BASE: process.env.ODDS_API_BASE,
    TOURNAMENT_ID: process.env.TOURNAMENT_ID,
    SAGE_MAX_PICKS: process.env.SAGE_MAX_PICKS,
    SAGE_MODEL: process.env.SAGE_MODEL,
  };
}

export async function runOnce(): Promise<number> {
  const env = readEnv();
  if (!env) return 2;

  const tournamentId = env.TOURNAMENT_ID ?? DEFAULT_TOURNAMENT_ID;
  const limit = Number.parseInt(env.SAGE_MAX_PICKS ?? "24", 10);
  const model = env.SAGE_MODEL ?? DEFAULT_MODEL;

  console.log(
    `[sage] tick ${new Date().toISOString()} tournament=${tournamentId} model=${model} limit=${limit}`,
  );

  let state;
  try {
    state = await ensureSageRegistered({
      apiKey: env.TOURNAMENTAL_API_KEY,
      apiBase: env.TOURNAMENTAL_API_BASE,
    });
  } catch (err) {
    console.error(`[sage] registration failed: ${(err as Error).message}`);
    return 3;
  }
  console.log(`[sage] registered as ${state.handle} bot_id=${state.bot_id}`);

  const [matches, oddsMap] = await Promise.all([
    fetchMatches({ apiBase: env.TOURNAMENTAL_API_BASE, tournamentId }),
    fetchOddsSnapshot({ oddsBase: env.ODDS_API_BASE, tournamentId }),
  ]);

  if (matches.length === 0) {
    console.warn("[sage] no matches returned from catalogue; nothing to do");
    return 0;
  }
  const upcoming = selectUpcoming(matches, new Date(), limit);
  console.log(
    `[sage] catalogue=${matches.length} upcoming=${upcoming.length} odds_rows=${oddsMap.size}`,
  );

  const claude: Anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const bot = new Bot({
    apiKey: env.TOURNAMENTAL_API_KEY,
    baseUrl: env.TOURNAMENTAL_API_BASE,
    botId: state.bot_id,
    tournamentId,
  });

  for (const match of upcoming) {
    const odds = oddsMap.get(match.id) ?? null;
    const outcome = await decide(match, odds, { claude, model });
    bot.pick(match.id, outcome);
    console.log(
      `[sage] ${match.id} ${match.home_code ?? "?"}-${match.away_code ?? "?"} -> ${outcome}`,
    );
  }

  if (bot.queueSize === 0) {
    console.log("[sage] no picks queued; exiting cleanly");
    return 0;
  }

  try {
    const res = await bot.flush();
    console.log(
      `[sage] flushed picks=${res.accepted} dropped=${res.dropped_picks.length} quota_remaining=${res.quota_remaining.picks_per_hour}`,
    );
    if (res.dropped_picks.length > 0) {
      for (const d of res.dropped_picks) {
        console.warn(`[sage] dropped ${d.match_id}: ${d.reason}`);
      }
    }
    return 0;
  } catch (err) {
    console.error(`[sage] flush failed: ${(err as Error).message}`);
    return 3;
  }
}

// Detect direct execution (PM2 `script: dist/index.js` or `tsx src/index.ts`).
// We compare resolved paths so tsx watch + node both work.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    const argvPath = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === argvPath;
  } catch {
    return false;
  }
})();

if (isMain) {
  runOnce()
    .then((code) => {
      console.log(`[sage] exit ${code} handle=${SAGE_HANDLE}`);
      process.exit(code);
    })
    .catch((err) => {
      console.error("[sage] unhandled error", err);
      process.exit(3);
    });
}
