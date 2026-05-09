/**
 * Phase-locked locomotion tests.
 *
 * The "no foot sliding" claim from docs/27a-fidelity-phase1-mocap-rig.md
 * is operationally:
 *
 *   meanFootSlide(samples) < 0.05 m/s
 *
 * over 30 s of synthetic velocity changes when each sample's chosen
 * locomotion clip natural-speed is a sensible match for the velocity.
 *
 * This file exercises the math without three.js. The end-to-end
 * "rendered foot doesn't slide" assertion lives in the Playwright suite.
 */
import { describe, it, expect } from "vitest";
import {
  bestLocomotionForSpeed,
  meanFootSlide,
  phaseLockRate,
} from "../src/locomotion.js";

describe("phaseLockRate", () => {
  it("rate = velocity / naturalSpeed in the unclamped band", () => {
    expect(phaseLockRate(4, 4)).toBe(1);
    expect(phaseLockRate(5, 4)).toBeCloseTo(1.25, 5);
    expect(phaseLockRate(3, 4)).toBeCloseTo(0.75, 5);
  });

  it("clamps to 0.5 at the floor", () => {
    expect(phaseLockRate(1, 4)).toBe(0.5);
  });

  it("clamps to 1.75 at the ceiling", () => {
    expect(phaseLockRate(20, 4)).toBe(1.75);
  });

  it("returns 1 for idle (velocity ~ 0)", () => {
    expect(phaseLockRate(0, 4)).toBe(1);
    expect(phaseLockRate(0.005, 4)).toBe(1);
  });

  it("returns 1 for the idle clip (naturalSpeed ~ 0)", () => {
    expect(phaseLockRate(2, 0)).toBe(1);
    expect(phaseLockRate(2, 0.01)).toBe(1);
  });

  it("respects custom min/max overrides", () => {
    expect(phaseLockRate(8, 4, { max: 1.5 })).toBe(1.5);
    expect(phaseLockRate(1, 4, { min: 0.25 })).toBe(0.25);
  });

  it("non-finite inputs degrade to 1", () => {
    expect(phaseLockRate(NaN, 4)).toBe(1);
    expect(phaseLockRate(4, Infinity)).toBeLessThan(2);
  });
});

describe("meanFootSlide", () => {
  it("zero drift when velocity matches a single clip's natural speed", () => {
    const samples = Array.from({ length: 60 }, () => ({ velocity: 4, naturalSpeed: 4, dt: 0.5 }));
    expect(meanFootSlide(samples)).toBe(0);
  });

  it("under 0.05 m/s drift over a 30s window of typical run speeds", () => {
    // Synthetic: jogger ramps from 3.5 m/s → 5.5 m/s, then coasts. Run clip
    // natural speed is 4.0; outside the [0.5, 1.75] clamp band there's
    // residual slide but the mean stays small.
    const samples: Array<{ velocity: number; naturalSpeed: number; dt: number }> = [];
    for (let t = 0; t < 30; t += 0.05) {
      const v = 4.0 + Math.sin(t * 0.5) * 0.3; // ±0.3 m/s wobble around 4.
      samples.push({ velocity: v, naturalSpeed: 4.0, dt: 0.05 });
    }
    expect(meanFootSlide(samples)).toBeLessThan(0.05);
  });

  it("drift grows when velocity exceeds clamp ceiling", () => {
    // Sustained 12 m/s on a 4 m/s clip — rate clamps at 1.75x ⇒ 7 m/s
    // effective animation, leaving 5 m/s residual. Mean ≈ 5.
    const samples = Array.from({ length: 60 }, () => ({ velocity: 12, naturalSpeed: 4, dt: 0.5 }));
    const drift = meanFootSlide(samples);
    expect(drift).toBeGreaterThan(4);
    expect(drift).toBeLessThan(6);
  });

  it("returns 0 for an empty sample list", () => {
    expect(meanFootSlide([])).toBe(0);
  });
});

describe("bestLocomotionForSpeed", () => {
  const naturalSpeeds = { idle: 0, walk: 1.4, run: 4.0, sprint: 6.5 };

  it("picks idle when velocity is ~0", () => {
    expect(bestLocomotionForSpeed(0.05, naturalSpeeds)).toBe("idle");
  });

  it("picks walk for slow-jog speeds", () => {
    expect(bestLocomotionForSpeed(1.5, naturalSpeeds)).toBe("walk");
  });

  it("picks run for typical match speeds", () => {
    expect(bestLocomotionForSpeed(4.2, naturalSpeeds)).toBe("run");
  });

  it("picks sprint for sprint speeds", () => {
    expect(bestLocomotionForSpeed(7.0, naturalSpeeds)).toBe("sprint");
  });

  it("falls back to a clip rather than null when speed is far above any natural", () => {
    expect(bestLocomotionForSpeed(20, naturalSpeeds)).not.toBeNull();
  });
});
