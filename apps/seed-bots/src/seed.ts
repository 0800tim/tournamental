/**
 * Seed pipeline orchestrator.
 *
 * Six phases per spec §4 / plan Task 19:
 *   1. roll personalities (chalk_score + engagement_tier)
 *   2. roll a favourite team (drives handle composition)
 *   3. roll identities (country, names, handle)
 *   4. pick avatars (face / dicebear / initials)
 *   5. build brackets (group + knockout picks + cup winner)
 *   6. roll activity timelines (created_at + save events)
 *
 * Output: an array of `Bot` records consumable by `write.ts`. The
 * pipeline is byte-deterministic in the master seed and the target
 * count is the upper bound (we never partial-generate).
 */

import { createHash } from "node:crypto";

import {
  buildBracket,
  loadFixtures,
  loadOddsSnapshot,
  TOP6_NATIONS,
  validateTargets as validateBracketTargets,
  type BotBracket,
  type FixtureRow,
  type OddsSnapshot,
  type ValidationSummary,
} from "./brackets.js";
import { pickAvatar, type AvatarSpec } from "./avatars.js";
import { rollIdentity, type Identity } from "./names.js";
import { rollPersonality, type Personality } from "./personalities.js";
import { rollTimeline, type BotTimeline } from "./timeline.js";
import { makeRng, rngWeightedIndex } from "./rng.js";

// ---------- favourite-team roller ----------

/**
 * Favourite-team prior. Sourced from `cup_winner_prior` so the most
 * popular favourites map to the most popular nations. Falls back to a
 * compact built-in if the odds snapshot is somehow empty (defensive).
 */
function rollFavouriteTeam(
  masterSeed: string,
  index: number,
  odds: OddsSnapshot,
): string {
  const prior = odds.cup_winner_prior.length
    ? odds.cup_winner_prior
    : [
        { team3: "BRA", p: 0.18 },
        { team3: "FRA", p: 0.15 },
        { team3: "ARG", p: 0.13 },
        { team3: "ENG", p: 0.12 },
        { team3: "ESP", p: 0.11 },
        { team3: "GER", p: 0.1 },
      ];
  const rng = makeRng(`${masterSeed}:fav:${index}`);
  const weights = prior.map((p) => p.p);
  const i = rngWeightedIndex(rng, weights);
  return prior[i]?.team3 ?? "BRA";
}

// ---------- bot record ----------

export interface Bot {
  readonly bot_id: string; // bot_<8-char-base32>
  readonly index: number;
  readonly personality: Personality;
  readonly favourite_team3: string;
  readonly identity: Identity;
  readonly avatar: AvatarSpec;
  readonly bracket: BotBracket;
  readonly timeline: BotTimeline;
}

// ---------- bot id ----------

/**
 * Deterministic `bot_<8-char-base32>` id. We hash (masterSeed + index)
 * with SHA-256, take the first 5 bytes, and base32-encode without
 * padding. The result is stable across reruns and unlikely to collide
 * within an 18k cohort (5 bytes = 40 bits = 1.1 x 10^12 keyspace).
 */
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function deriveBotId(masterSeed: string, index: number): string {
  const h = createHash("sha256")
    .update(`${masterSeed}:id:${index}`)
    .digest();
  // First 5 bytes -> 8 base32 chars (40 bits).
  let bits = 0;
  let bitCount = 0;
  let out = "";
  for (let i = 0; i < 5; i++) {
    bits = (bits << 8) | (h[i] ?? 0);
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const idx = (bits >>> bitCount) & 0x1f;
      out += BASE32[idx];
    }
  }
  return `bot_${out}`;
}

// ---------- pipeline ----------

export interface GenerateOptions {
  readonly seed: string;
  readonly target: number;
}

export function generateBots(opts: GenerateOptions): Bot[] {
  const fixtures = loadFixtures();
  const odds = loadOddsSnapshot();

  const bots: Bot[] = [];
  for (let index = 0; index < opts.target; index++) {
    const personality = rollPersonality(opts.seed, index);
    const favourite_team3 = rollFavouriteTeam(opts.seed, index, odds);
    const identity = rollIdentity({
      masterSeed: opts.seed,
      index,
      favouriteTeam3: favourite_team3,
    });
    const avatar = pickAvatar({
      masterSeed: opts.seed,
      index,
      handle: identity.handle,
    });
    const bracket = buildBracket({
      masterSeed: opts.seed,
      index,
      personality,
      fixtures,
      odds,
    });
    const timeline = rollTimeline({
      masterSeed: opts.seed,
      index,
      target: opts.target,
      personality,
    });
    bots.push({
      bot_id: deriveBotId(opts.seed, index),
      index,
      personality,
      favourite_team3,
      identity,
      avatar,
      bracket,
      timeline,
    });
  }
  return bots;
}

// ---------- validation ----------

/**
 * Run the spec's validation targets against the generated cohort.
 * Returns a JSON-friendly summary the CLI prints + writes to disk.
 */
export function validateTargets(bots: ReadonlyArray<Bot>): ValidationSummary {
  return validateBracketTargets(bots.map((b) => b.bracket));
}

/** Convenience helpers for the dry-run printout. */
export function summariseCountries(bots: ReadonlyArray<Bot>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bots) {
    out[b.identity.country] = (out[b.identity.country] ?? 0) + 1;
  }
  return out;
}

export function summariseAvatars(bots: ReadonlyArray<Bot>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bots) {
    out[b.avatar.kind] = (out[b.avatar.kind] ?? 0) + 1;
  }
  return out;
}

export function summariseEngagement(
  bots: ReadonlyArray<Bot>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bots) {
    out[b.personality.engagement_tier] =
      (out[b.personality.engagement_tier] ?? 0) + 1;
  }
  return out;
}

export function summariseCupWinners(bots: ReadonlyArray<Bot>): {
  top6_rate: number;
  distribution: Record<string, number>;
} {
  const dist: Record<string, number> = {};
  for (const b of bots) {
    dist[b.bracket.cup_winner_team3] =
      (dist[b.bracket.cup_winner_team3] ?? 0) + 1;
  }
  const top6 = TOP6_NATIONS.reduce((a, c) => a + (dist[c] ?? 0), 0);
  return {
    top6_rate: bots.length > 0 ? top6 / bots.length : 0,
    distribution: dist,
  };
}

// Re-export so write.ts and the CLI share one fixture row type.
export type { FixtureRow };
