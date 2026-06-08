/**
 * Example 7: ensemble vote.
 *
 * Three independent strategies (chalk, mean-reversion, recent-form) each
 * cast a vote per match. Majority wins; ties fall back to chalk. Submits
 * one bot per ensemble result. This is the simplest robust strategy:
 * uncorrelated wrongness cancels out.
 *
 * Run:
 *   TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/07-ensemble.ts
 */

import { Bot, type OddsSnapshot, type Outcome } from "../src/index.js";

interface MatchCtx {
  odds: OddsSnapshot;
  recent_form: { home: number; away: number };
}

const MATCHES: MatchCtx[] = [
  {
    odds: { match_id: "wc-2026-m01", home_win: 0.55, draw: 0.27, away_win: 0.18 },
    recent_form: { home: 2.1, away: 0.6 },
  },
  {
    odds: { match_id: "wc-2026-m02", home_win: 0.38, draw: 0.32, away_win: 0.30 },
    recent_form: { home: 1.2, away: 1.4 },
  },
];

const chalk = (m: MatchCtx): Outcome => {
  const t: [Outcome, number][] = [
    ["home_win", m.odds.home_win],
    ["draw", m.odds.draw],
    ["away_win", m.odds.away_win],
  ];
  t.sort((a, b) => b[1] - a[1]);
  return t[0][0];
};

const meanReversion = (m: MatchCtx): Outcome => {
  const t: [Outcome, number][] = [
    ["home_win", m.odds.home_win],
    ["draw", m.odds.draw],
    ["away_win", m.odds.away_win],
  ];
  t.sort((a, b) => a[1] - b[1]);
  return t[0][0];
};

const recentForm = (m: MatchCtx): Outcome => {
  const diff = m.recent_form.home - m.recent_form.away;
  if (diff > 0.5) return "home_win";
  if (diff < -0.5) return "away_win";
  return "draw";
};

function vote(m: MatchCtx): Outcome {
  const votes: Outcome[] = [chalk(m), meanReversion(m), recentForm(m)];
  const tally: Record<Outcome, number> = {
    home_win: 0,
    draw: 0,
    away_win: 0,
  };
  for (const v of votes) tally[v] += 1;
  const sorted = (Object.entries(tally) as [Outcome, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  if (sorted[0][1] === sorted[1][1]) return chalk(m);
  return sorted[0][0];
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey) {
    console.error("Set TOURNAMENTAL_API_KEY to run this example.");
    process.exit(1);
  }
  const bot = new Bot({ apiKey, botId: "example-ensemble-01" });
  for (const m of MATCHES) bot.pick(m.odds.match_id, vote(m));
  const res = await bot.flush();
  console.log(`ensemble bot submitted: accepted=${res.accepted}`);
}

if (process.argv[1] && process.argv[1].endsWith("07-ensemble.ts")) {
  void main();
}

export { vote, chalk, meanReversion, recentForm };
