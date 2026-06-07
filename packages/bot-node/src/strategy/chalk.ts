import { createHash } from "node:crypto";

import type { MatchSpec, Outcome } from "../types.js";
import type { PickDecision, Strategy, StrategyContext } from "./index.js";

/**
 * Deterministic 32-bit PRNG seeded by sha256(seed || salt). Avoids pulling in
 * a dependency; output quality is sufficient for chalk weighting.
 */
function seededFraction(seed: string, salt: string): number {
  const digest = createHash("sha256").update(`${seed}::${salt}`).digest();
  // Take the first 6 bytes (48 bits) and scale to [0, 1).
  const high = digest.readUInt32BE(0);
  const low = digest.readUInt16BE(4);
  const combined = high * 0x1_0000 + low;
  return combined / 0x1_0000_0000_0000;
}

/**
 * Chalk-weighted strategy.
 *
 * For each match the bot draws a uniform deterministic fraction `r` in [0, 1)
 * keyed by `(seed, match_id)`. The match's three implied probabilities are
 * blended toward the favourite by `chalk_score`:
 *
 *   blended[i] = (1 - chalk) * implied[i] + chalk * spike_on_favourite[i]
 *
 * with `chalk_score = 1.0` collapsing to "always pick the favourite" and
 * `chalk_score = 0` reproducing the raw implied distribution. The pick is
 * then the outcome whose cumulative blended mass exceeds `r`.
 *
 * Falls back to a uniform 1/3 (group) or 1/2 (knockout) distribution if no
 * odds were provided on the match spec - useful for synthetic tests.
 */
export const chalkStrategy: Strategy = {
  name: "chalk-v1",
  decide(match: MatchSpec, ctx: StrategyContext): PickDecision {
    const outcomes: Outcome[] = match.allows_draw
      ? ["home_win", "draw", "away_win"]
      : ["home_win", "away_win"];

    const implied = pickImplied(match, outcomes);
    const favouriteIndex = implied.indexOf(Math.max(...implied));
    const chalk = clamp01(ctx.chalk_score);

    const blended = implied.map((p, i) => {
      const spike = i === favouriteIndex ? 1 : 0;
      return (1 - chalk) * p + chalk * spike;
    });

    // Re-normalise in case of floating-point drift.
    const total = blended.reduce((s, x) => s + x, 0) || 1;
    const normalised = blended.map((b) => b / total);

    const r = seededFraction(ctx.seed, match.match_id);
    let cumulative = 0;
    for (let i = 0; i < normalised.length; i++) {
      cumulative += normalised[i]!;
      if (r < cumulative) {
        return { outcome: outcomes[i]! };
      }
    }
    return { outcome: outcomes[outcomes.length - 1]! };
  },
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.75;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pickImplied(match: MatchSpec, outcomes: Outcome[]): number[] {
  const odds = match.odds;
  if (!odds) {
    const equal = 1 / outcomes.length;
    return outcomes.map(() => equal);
  }
  const raw = outcomes.map((o) => Math.max(0, odds[o] ?? 0));
  const total = raw.reduce((s, x) => s + x, 0);
  if (total <= 0) {
    const equal = 1 / outcomes.length;
    return outcomes.map(() => equal);
  }
  return raw.map((x) => x / total);
}

export function defaultChalkScore(seed: string): number {
  // Uniform in [0.65, 0.90] per spec §15 default operator profile.
  const f = seededFraction(seed, "chalk_score");
  return 0.65 + f * 0.25;
}
