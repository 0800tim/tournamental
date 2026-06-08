/**
 * Deterministic PRNG helpers.
 *
 * Every random draw in the seed pipeline goes through a `seedrandom`
 * instance keyed off the master seed string. We never call Math.random()
 * anywhere in the pipeline so a re-run with the same seed produces
 * byte-identical output.
 */

import seedrandom from "seedrandom";

export type Rng = () => number;

export function makeRng(seed: string): Rng {
  // seedrandom returns a function that yields [0, 1).
  return seedrandom(seed);
}

/** Uniform integer in [lo, hi] inclusive. */
export function rngInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Pick one element of `arr` uniformly. Throws on empty array. */
export function rngPick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("rngPick: empty array");
  const x = arr[Math.floor(rng() * arr.length)];
  if (x === undefined) throw new Error("rngPick: undefined draw");
  return x;
}

/**
 * Weighted pick. `weights` does not have to be normalised.
 * Returns the index of the chosen entry.
 */
export function rngWeightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) throw new Error("rngWeightedIndex: non-positive total weight");
  let target = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    target -= w;
    if (target < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Truncated normal sample using Box-Muller. Re-samples until the value
 * falls in [lo, hi]. Bounded re-tries (16) to avoid an infinite loop on
 * pathological inputs.
 */
export function rngTruncatedNormal(
  rng: Rng,
  mean: number,
  stdev: number,
  lo: number,
  hi: number,
): number {
  for (let attempt = 0; attempt < 16; attempt++) {
    // Box-Muller. Use two PRNG draws; guard against u1=0 (log(0)=-Inf).
    let u1 = rng();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const x = mean + stdev * z;
    if (x >= lo && x <= hi) return x;
  }
  // Fall back to clamped mean if we never landed in-range.
  return Math.max(lo, Math.min(hi, mean));
}
