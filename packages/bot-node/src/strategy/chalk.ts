/**
 * Chalk-weighted strategy for @tournamental/bot-node.
 *
 * ---------------------------------------------------------------------------
 * CHANGELOG
 *
 * Tournamental v0.2 calibration (2026-06):
 *   - Chalk-score distribution moved from uniform [0.65, 0.90] to a three-tier
 *     spread (50% [0.70-0.90], 30% [0.40-0.70], 20% [0.05-0.40]) so the swarm
 *     surfaces a chalk-follower majority alongside a meaningful contrarian
 *     minority instead of collapsing onto a single favoured outcome.
 *   - Added an optional "darling team" bias: each bot sentimentally favours one
 *     of the FIFA top-16 sides so cup-winner picks fan across the genuine
 *     contenders instead of crowning longshots (no more "bot 308006 picks
 *     Cape Verde"). Restriction to top-16 is hard-coded inside the package so
 *     external operators do not need to ship a teams catalogue alongside the
 *     SDK.
 *   - Darling bonus tuned down from 0.18 to 0.10 so the favoured side is
 *     nudged rather than dominated.
 *
 *   This is a breaking semantic change for downstream consumers (same seed
 *   no longer reproduces the v0.1 picks); the package version is bumped to
 *   0.2.0 accordingly.
 * ---------------------------------------------------------------------------
 */

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
 * FIFA top-16 cohort as of the 2026 World Cup draw (fifa_ranking_at_2026 <=
 * 16, intersected with the 48 qualified sides).
 *
 * The genuine top-16 by FIFA rank that are actually in the tournament is 14
 * teams (ranks 10 and 12 belong to non-qualified sides, e.g. Italy). We embed
 * those 14 codes here so the strategy file is self-contained and the SDK has
 * zero coupling to the canonical data/fifa-wc-2026/teams.json at runtime;
 * external operators just `npm i @tournamental/bot-node` and the darling
 * picker still works.
 *
 * Ordering is by FIFA rank ascending so the weighting curve (1/sqrt(rank))
 * still favours stronger sides while letting rank-16 sit in the cohort.
 */
const DARLING_TOP_TEAMS: ReadonlyArray<{ code: string; rank: number }> = [
  { code: "ARG", rank: 1 },
  { code: "FRA", rank: 2 },
  { code: "ESP", rank: 3 },
  { code: "ENG", rank: 4 },
  { code: "BRA", rank: 5 },
  { code: "NED", rank: 6 },
  { code: "POR", rank: 7 },
  { code: "BEL", rank: 8 },
  { code: "CRO", rank: 9 },
  { code: "GER", rank: 11 },
  { code: "MAR", rank: 13 },
  { code: "COL", rank: 14 },
  { code: "URU", rank: 15 },
  { code: "MEX", rank: 16 },
];

/**
 * Public read-only view of the darling cohort so operators can audit the
 * embedded list without reaching into module internals.
 */
export const DARLING_TEAM_POOL: ReadonlyArray<{ code: string; rank: number }> =
  DARLING_TOP_TEAMS;

/**
 * Bonus the bot adds to its darling team's outcome before normalisation.
 * Sits at 0.10 (v0.2). Higher values cluster the bot too aggressively on its
 * sentimental favourite; lower values stop affecting the cup-winner spread.
 */
const DARLING_BONUS = 0.10;

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
 * `chalk_score = 0` reproducing the raw implied distribution. A small darling
 * bonus is then added to the side whose `home_team` or `away_team` code
 * matches the bot's `darling_team`, before re-normalisation. The pick is the
 * outcome whose cumulative blended mass exceeds `r`.
 *
 * Falls back to a uniform 1/3 (group) or 1/2 (knockout) distribution if no
 * odds were provided on the match spec; useful for synthetic tests.
 */
export const chalkStrategy: Strategy = {
  name: "chalk-v1",
  decide(match: MatchSpec, ctx: StrategyContext): PickDecision {
    const outcomes: Outcome[] = match.allows_draw
      ? ["home_win", "draw", "away_win"]
      : ["home_win", "away_win"];

    const implied = pickImplied(match, outcomes);
    let favouriteIndex = 0;
    for (let i = 1; i < implied.length; i++) {
      if (implied[i]! > implied[favouriteIndex]!) favouriteIndex = i;
    }
    const chalk = clamp01(ctx.chalk_score);

    const darling = ctx.darling_team;
    const darlingBonusHome = darling && match.home_team === darling ? DARLING_BONUS : 0;
    const darlingBonusAway = darling && match.away_team === darling ? DARLING_BONUS : 0;

    const blended: number[] = new Array(outcomes.length);
    let total = 0;
    for (let i = 0; i < outcomes.length; i++) {
      const spike = i === favouriteIndex ? 1 : 0;
      let v = (1 - chalk) * implied[i]! + chalk * spike;
      if (outcomes[i] === "home_win") v += darlingBonusHome;
      if (outcomes[i] === "away_win") v += darlingBonusAway;
      blended[i] = Math.max(0, v);
      total += blended[i]!;
    }
    if (total <= 0) total = 1;

    const r = seededFraction(ctx.seed, match.match_id);
    let cumulative = 0;
    for (let i = 0; i < outcomes.length; i++) {
      cumulative += blended[i]! / total;
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

/**
 * Default chalk-score distribution. Bucketed three-tier:
 *   50% chalk-followers   [0.70, 0.90]
 *   30% moderates         [0.40, 0.70]
 *   20% contrarians       [0.05, 0.40]
 *
 * Mirrors `chalkScoreForBot` in the browser-swarm regenerate so the
 * SDK-generated picks and the Tournamental swarm use the same score
 * distribution and do not diverge across surfaces. Deterministic: same seed
 * always lands in the same tier and the same value inside the tier.
 */
export function defaultChalkScore(seed: string): number {
  const tierRoll = seededFraction(seed, "tier");
  const innerRoll = seededFraction(seed, "chalk_score");
  if (tierRoll < 0.5) return 0.7 + innerRoll * 0.2;
  if (tierRoll < 0.8) return 0.4 + innerRoll * 0.3;
  return 0.05 + innerRoll * 0.35;
}

/**
 * Pick a deterministic darling team for the supplied seed.
 *
 * Draws from the embedded FIFA top-16 cohort weighted by 1/sqrt(rank) so
 * rank-1 sides still dominate the distribution while rank-16 sides retain
 * meaningful representation. Operators wanting a custom pool (different
 * tournament, different sport) can pass `pool` to override the default.
 *
 * Returns null when the pool is empty so callers can detect misconfiguration
 * (e.g. an operator clearing the pool but forgetting to disable the darling
 * concept entirely).
 */
export function defaultDarlingTeam(
  seed: string,
  pool: ReadonlyArray<{ code: string; rank: number }> = DARLING_TOP_TEAMS,
): string | null {
  if (pool.length === 0) return null;
  const weights = pool.map((t) => 1 / Math.sqrt(Math.max(1, t.rank)));
  const total = weights.reduce((s, x) => s + x, 0);
  const r = seededFraction(seed, "darling") * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += weights[i]!;
    if (r < acc) return pool[i]!.code;
  }
  return pool[pool.length - 1]!.code;
}
