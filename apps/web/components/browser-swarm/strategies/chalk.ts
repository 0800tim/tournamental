/**
 * Browser chalk-weighted strategy.
 *
 * Synchronous, deterministic, allocation-light so the worker can run
 * millions of `decide()` calls per second on a mid-range laptop. Uses a
 * cheap xorshift32 PRNG seeded by a hash of `(bot_seed, match_id)` so
 * the same bot produces the same pick across re-runs (audit requirement
 * §15.3).
 *
 * Output shape matches the node-side `chalk-v1` strategy in
 * `packages/bot-node/src/strategy/chalk.ts`. The seed mixing is a
 * lightweight FNV-1a so we don't pull in WebCrypto on the hot path; the
 * tradeoff is acceptable because the deterministic property comes from
 * the seed being committed in the merkle leaf, not from the PRNG itself
 * being cryptographically strong.
 */

import type { MatchOdds, MatchSpec, Outcome } from "../types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function seededFraction(seed: string, salt: string): number {
  // FNV-1a is fast and good enough for chalk weighting. We blend two
  // hashes so adjacent seeds don't produce adjacent fractions.
  const a = fnv1a(`${seed}::${salt}`);
  const b = fnv1a(`${salt}::${seed}`);
  const combined = (a ^ (b * 2654435761)) >>> 0;
  return combined / 0x1_0000_0000;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.75;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pickImplied(match: MatchSpec, outcomes: Outcome[]): number[] {
  const odds: MatchOdds | undefined = match.odds;
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

export interface ChalkContext {
  readonly seed: string;
  readonly chalk_score: number;
}

export interface ChalkPick {
  readonly outcome: Outcome;
}

export function chalkDecide(match: MatchSpec, ctx: ChalkContext): ChalkPick {
  const outcomes: Outcome[] = match.allows_draw
    ? ["home_win", "draw", "away_win"]
    : ["home_win", "away_win"];

  const implied = pickImplied(match, outcomes);
  let favouriteIndex = 0;
  for (let i = 1; i < implied.length; i++) {
    if (implied[i]! > implied[favouriteIndex]!) favouriteIndex = i;
  }
  const chalk = clamp01(ctx.chalk_score);

  let total = 0;
  const blended: number[] = new Array(outcomes.length);
  for (let i = 0; i < outcomes.length; i++) {
    const spike = i === favouriteIndex ? 1 : 0;
    const v = (1 - chalk) * implied[i]! + chalk * spike;
    blended[i] = v;
    total += v;
  }
  if (total <= 0) total = 1;

  const r = seededFraction(ctx.seed, match.match_id);
  let cumulative = 0;
  for (let i = 0; i < outcomes.length; i++) {
    cumulative += blended[i]! / total;
    if (r < cumulative) return { outcome: outcomes[i]! };
  }
  return { outcome: outcomes[outcomes.length - 1]! };
}

/**
 * Default chalk-score distribution. Bucketed three-tier:
 *   50% chalk-followers   [0.70, 0.90]
 *   30% moderates         [0.40, 0.70]
 *   20% contrarians       [0.05, 0.40]
 *
 * Mirrors `chalkScoreForBot` in regenerate.ts so the worker-generated
 * picks and the on-demand /run/bots/* regeneration use the same score
 * distribution and don't diverge.
 */
export function defaultChalkScore(seed: string): number {
  const tierRoll = seededFraction(seed, "tier");
  const innerRoll = seededFraction(seed, "chalk_score");
  if (tierRoll < 0.5) return 0.7 + innerRoll * 0.2;
  if (tierRoll < 0.8) return 0.4 + innerRoll * 0.3;
  return 0.05 + innerRoll * 0.35;
}

export const CHALK_STRATEGY_NAME = "chalk-v1" as const;
