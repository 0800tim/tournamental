/**
 * Example 8: post-tournament best-of swarm.
 *
 * Saves N bracket variations pre-kickoff (one bot per variation) and,
 * after the tournament finishes, scores them locally to find the best
 * surviving bracket. Spec §15.1 explains why card-stacking the group
 * stage is the highest-leverage strategy for the perfect-bracket prize.
 *
 * This example deliberately uses the low-level bulk helper to submit
 * many variations in one round trip: a single request with N submissions
 * is cheaper than N separate flushes.
 *
 * Run:
 *   TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/08-post-tournament-bestof.ts
 */

import {
  submitBulkPicks,
  type BulkSubmission,
  type Outcome,
  type Pick,
} from "../src/index.js";

const VARIATIONS = 200;
const MATCHES = 48;
const OUTCOMES: Outcome[] = ["home_win", "draw", "away_win"];

function buildVariation(seed: number): Pick[] {
  let s = seed >>> 0;
  const rng = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  return Array.from({ length: MATCHES }, (_, i) => ({
    match_id: `wc-2026-g${String(i + 1).padStart(2, "0")}`,
    outcome: OUTCOMES[Math.floor(rng() * 3)],
  }));
}

function scoreBracket(picks: Pick[], outcomes: Map<string, Outcome>): number {
  let n = 0;
  for (const pick of picks) {
    if (outcomes.get(pick.match_id) === pick.outcome) n += 1;
  }
  return n;
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey) {
    console.error("Set TOURNAMENTAL_API_KEY to run this example.");
    process.exit(1);
  }
  const submissions: BulkSubmission["submissions"] = [];
  for (let i = 0; i < VARIATIONS; i++) {
    submissions.push({
      bot_id: `example-bestof-${String(i).padStart(3, "0")}`,
      picks: buildVariation(i + 1),
    });
  }
  const res = await submitBulkPicks({ apiKey }, submissions);
  console.log(
    `bestof: submitted ${VARIATIONS} variations, accepted=${res.accepted}`,
  );

  const finalOutcomes = new Map<string, Outcome>();
  for (let i = 1; i <= MATCHES; i++) {
    finalOutcomes.set(
      `wc-2026-g${String(i).padStart(2, "0")}`,
      OUTCOMES[i % 3],
    );
  }
  let best = { idx: -1, score: -1 };
  for (let i = 0; i < submissions.length; i++) {
    const sc = scoreBracket(submissions[i].picks, finalOutcomes);
    if (sc > best.score) best = { idx: i, score: sc };
  }
  console.log(
    `best post-tournament bracket: bot=${submissions[best.idx].bot_id} score=${best.score}/${MATCHES}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("08-post-tournament-bestof.ts")) {
  void main();
}

export { buildVariation, scoreBracket };
