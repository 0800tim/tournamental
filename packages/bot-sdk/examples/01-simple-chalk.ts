/**
 * Example 1: simple chalk bot.
 *
 * The simplest possible bot: follow the bookmaker's most-likely outcome.
 * "Chalk" is sports betting slang for "favourite". This bot wins about
 * 55% of group-stage matches and is the baseline every other strategy
 * is benchmarked against.
 *
 * Run:
 *   TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/01-simple-chalk.ts
 */

import { Bot, type OddsSnapshot, type Outcome } from "../src/index.js";

const SAMPLE_ODDS: OddsSnapshot[] = [
  { match_id: "wc-2026-m01", home_win: 0.55, draw: 0.27, away_win: 0.18 },
  { match_id: "wc-2026-m02", home_win: 0.22, draw: 0.28, away_win: 0.50 },
  { match_id: "wc-2026-m03", home_win: 0.34, draw: 0.33, away_win: 0.33 },
];

function pickChalk(odds: OddsSnapshot): Outcome {
  const triples: [Outcome, number][] = [
    ["home_win", odds.home_win],
    ["draw", odds.draw],
    ["away_win", odds.away_win],
  ];
  triples.sort((a, b) => b[1] - a[1]);
  return triples[0][0];
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey) {
    console.error("Set TOURNAMENTAL_API_KEY to run this example.");
    process.exit(1);
  }
  const bot = new Bot({ apiKey, botId: "example-chalk-01" });
  for (const odds of SAMPLE_ODDS) {
    bot.pick(odds.match_id, pickChalk(odds));
  }
  const res = await bot.flush();
  console.log(`chalk bot submitted: accepted=${res.accepted}`);
}

if (process.argv[1] && process.argv[1].endsWith("01-simple-chalk.ts")) {
  void main();
}

export { pickChalk };
