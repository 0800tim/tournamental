/**
 * Deterministic RNG wrapper around `seedrandom`.
 *
 * The whole simulation threads a single Rng instance so that any change to
 * the call order (e.g. adding a new event-type roll) is observable as a
 * golden-output test failure, not a silent drift.
 */
import seedrandom from "seedrandom";

export class Rng {
  private prng: () => number;

  constructor(seed: string | number) {
    this.prng = seedrandom(String(seed));
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.prng();
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.prng();
  }

  /** Uniform integer in [min, max] inclusive. */
  intRange(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.prng());
  }

  /** Standard normal via Box-Muller (one sample per call). */
  normal(mean = 0, stddev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.prng();
    while (v === 0) v = this.prng();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stddev + mean;
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick on empty array");
    return arr[Math.floor(this.prng() * arr.length)] as T;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.prng() < p;
  }
}
