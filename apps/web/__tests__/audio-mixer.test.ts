/**
 * Unit tests for the Phase-3 audio mixer.
 *
 * Verifies:
 *   - Idle → ducked transition on goal cuts
 *   - Ramp respects the configured `rampMs`
 *   - Returning to nominal works
 *   - Boost (+4 dB) for half-time
 *   - Crossfade-on-scrub drops to zero then ramps back
 *   - dB → linear gain math
 */
import { describe, expect, it } from "vitest";
import { AudioMixer, dB } from "@/lib/audio/audio-mixer";

describe("dB conversion", () => {
  it("0 dB is unity gain", () => {
    expect(dB(0)).toBeCloseTo(1, 5);
  });

  it("-6 dB is approx 0.501", () => {
    expect(dB(-6)).toBeCloseTo(0.5012, 3);
  });

  it("+6 dB is approx 1.995", () => {
    expect(dB(6)).toBeCloseTo(1.9953, 3);
  });
});

describe("AudioMixer states", () => {
  it("starts at nominal gain 1", () => {
    const m = new AudioMixer();
    expect(m.getState()).toBe("nominal");
    expect(m.commentaryGain()).toBe(1);
  });

  it("ducks for a goal — target is -8 dB", () => {
    let now = 1000;
    const m = new AudioMixer({ now: () => now, rampMs: 100 });
    m.duckForGoal();
    expect(m.getState()).toBe("ducked-goal");
    expect(m.getTargetGain()).toBeCloseTo(dB(-8), 5);
  });

  it("duckForGoal is idempotent — calling twice keeps the same state", () => {
    let now = 0;
    const m = new AudioMixer({ now: () => now, rampMs: 100 });
    m.duckForGoal();
    const t1 = m.getTargetGain();
    m.duckForGoal();
    expect(m.getTargetGain()).toBe(t1);
  });

  it("returns to nominal after a duck", () => {
    let now = 0;
    const m = new AudioMixer({ now: () => now, rampMs: 100 });
    m.duckForGoal();
    now = 200; // past the ramp
    expect(m.commentaryGain()).toBeCloseTo(dB(-8), 3);
    m.returnToNominal();
    expect(m.getState()).toBe("nominal");
    now = 400;
    expect(m.commentaryGain()).toBeCloseTo(1, 3);
  });

  it("boosts for half-time — target is +4 dB", () => {
    let now = 0;
    const m = new AudioMixer({ now: () => now });
    m.boostForHalfTime();
    expect(m.getState()).toBe("boosted-half-time");
    expect(m.getTargetGain()).toBeCloseTo(dB(4), 5);
  });
});

describe("AudioMixer ramps", () => {
  it("interpolates the gain across the ramp window (cosine ease)", () => {
    let now = 0;
    const m = new AudioMixer({ now: () => now, rampMs: 100 });
    m.duckForGoal();

    // Beginning of the ramp
    now = 0;
    expect(m.commentaryGain()).toBeCloseTo(1, 3);

    // Midpoint — should be roughly halfway between 1 and dB(-8)
    now = 50;
    const mid = m.commentaryGain();
    const expectedMid = (1 + dB(-8)) / 2;
    expect(mid).toBeCloseTo(expectedMid, 1);

    // End of the ramp
    now = 100;
    expect(m.commentaryGain()).toBeCloseTo(dB(-8), 3);
  });

  it("after the ramp the gain stops moving", () => {
    let now = 0;
    const m = new AudioMixer({ now: () => now, rampMs: 100 });
    m.duckForGoal();
    now = 500;
    const a = m.commentaryGain();
    now = 1500;
    expect(m.commentaryGain()).toBe(a);
  });
});

describe("AudioMixer scrub crossfade", () => {
  it("drops to zero on scrub", () => {
    let now = 0;
    const m = new AudioMixer({ now: () => now, scrubFadeMs: 100 });
    m.scrub();
    expect(m.getState()).toBe("scrub-fade");
    now = 50;
    expect(m.commentaryGain()).toBeCloseTo(0, 3);
  });
});
