/**
 * Deterministic PRNG helpers for mock data generators.
 *
 * The mock leaderboard, points-history, and activity feed all need to
 * be reproducible — the same seed must always produce the same output
 * so that screenshots, snapshot tests, and "did the page change?"
 * comparisons aren't noisy.
 *
 * We use a small xmur3 → mulberry32 pair (both ~10 lines, both public-
 * domain) instead of pulling in seedrandom. xmur3 hashes a string seed
 * into a 32-bit integer; mulberry32 turns that into a stream of doubles.
 */

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  // Ensure non-zero result so a downstream mulberry32 always produces
  // a real stream (seed === 0 collapses to a constant).
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0 || 1;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(seed: string): () => number {
  return mulberry32(hashSeed(seed));
}

/**
 * Pick an integer in [min, max] using a seeded RNG instance.
 */
export function pickInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Deterministic Fisher-Yates shuffle. Returns a new array; the input
 * is untouched.
 */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
