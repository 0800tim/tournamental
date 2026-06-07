/**
 * Example 6: Kelly criterion sizing.
 *
 * Tournamental's bot leaderboard does not have a stake-sized bet; bots get
 * one pick per match. So "Kelly" here is repurposed as a *conviction
 * filter*: only submit a pick when the Kelly fraction exceeds a
 * threshold; abstain (no pick) otherwise. Abstaining is allowed; the
 * server simply scores 0 on unsubmitted matches.
 *
 * Run:
 *   TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/06-kelly.ts
 */

import { Bot, type OddsSnapshot, type Outcome } from "../src/index.js";

const MATCHES: { odds: OddsSnapshot; model_probs: [number, number, number] }[] =
  [
    {
      odds: {
        match_id: "wc-2026-m01",
        home_win: 0.5,
        draw: 0.25,
        away_win: 0.25,
      },
      model_probs: [0.62, 0.22, 0.16],
    },
    {
      odds: {
        match_id: "wc-2026-m02",
        home_win: 0.4,
        draw: 0.3,
        away_win: 0.3,
      },
      model_probs: [0.41, 0.29, 0.30],
    },
  ];

const OUTCOMES: Outcome[] = ["home_win", "draw", "away_win"];
const KELLY_THRESHOLD = 0.05;

function kellyFraction(modelProb: number, marketProb: number): number {
  const decimalOdds = 1 / marketProb;
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const f = (b * modelProb - (1 - modelProb)) / b;
  return Math.max(0, f);
}

function pickByKelly(
  odds: OddsSnapshot,
  modelProbs: [number, number, number],
): Outcome | null {
  const market = [odds.home_win, odds.draw, odds.away_win];
  let bestOutcome: Outcome | null = null;
  let bestFraction = 0;
  for (let i = 0; i < 3; i++) {
    const f = kellyFraction(modelProbs[i], market[i]);
    if (f > bestFraction) {
      bestFraction = f;
      bestOutcome = OUTCOMES[i];
    }
  }
  return bestFraction >= KELLY_THRESHOLD ? bestOutcome : null;
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey) {
    console.error("Set TOURNAMENTAL_API_KEY to run this example.");
    process.exit(1);
  }
  const bot = new Bot({ apiKey, botId: "example-kelly-01" });
  let abstained = 0;
  for (const m of MATCHES) {
    const pick = pickByKelly(m.odds, m.model_probs);
    if (pick === null) {
      abstained += 1;
      continue;
    }
    bot.pick(m.odds.match_id, pick);
  }
  const res = await bot.flush();
  console.log(
    `kelly bot submitted: accepted=${res.accepted} abstained=${abstained}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("06-kelly.ts")) {
  void main();
}

export { kellyFraction, pickByKelly };
