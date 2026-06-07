/**
 * Bot personality roller.
 *
 * Two dimensions per bot (spec §4.3, §4.4):
 *   - `chalk_score ∈ [0.65, 0.90]`: truncated normal, mean 0.78, stdev 0.07.
 *     Drives how strongly the bot follows the market favourite in each match.
 *   - `engagement_tier`: 10% high, 30% medium, 60% low (set-and-forget).
 *     Determines the activity-timeline footprint of the bot.
 */

import { makeRng, rngTruncatedNormal, rngWeightedIndex } from "./rng.js";

export type EngagementTier = "high" | "med" | "low";

export interface Personality {
  readonly chalk_score: number;
  readonly engagement_tier: EngagementTier;
}

const TIERS: readonly EngagementTier[] = ["high", "med", "low"];
const TIER_WEIGHTS: readonly number[] = [10, 30, 60];

/**
 * Roll a personality deterministically from the master seed and the
 * bot's index. We name-space the sub-stream with a fixed suffix so
 * adding a new feature later doesn't perturb existing rolls (each
 * dimension has its own keyed PRNG).
 */
export function rollPersonality(masterSeed: string, index: number): Personality {
  const rngChalk = makeRng(`${masterSeed}:personality:chalk:${index}`);
  const rngTier = makeRng(`${masterSeed}:personality:tier:${index}`);
  const chalk_score = rngTruncatedNormal(rngChalk, 0.78, 0.07, 0.65, 0.9);
  const tierIdx = rngWeightedIndex(rngTier, TIER_WEIGHTS);
  const engagement_tier = TIERS[tierIdx] ?? "low";
  return { chalk_score, engagement_tier };
}
