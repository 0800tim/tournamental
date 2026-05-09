/**
 * Phase-4 sweat / fatigue shader tests.
 */
import { describe, it, expect } from "vitest";
import {
  addDirt,
  applyDirtToMaterial,
  applySweatToMaterial,
  createFatigueState,
  createSweatUniforms,
  fatigueShaderEnabled,
  fatigueSubstitutionBias,
  halfTimeBoost,
  shouldSuggestSubstitution,
  tickFatigue,
  SWEAT_SHADER_FRAGMENT_CHUNK,
  type MaterialLike,
} from "../src/sweat-shader.js";

describe("createFatigueState", () => {
  it("starts at zero fatigue and zero sweat", () => {
    const s = createFatigueState();
    expect(s.fatigue).toBe(0);
    expect(s.sweat).toBe(0);
    expect(s.matchClockSec).toBe(0);
    expect(s.minutesPlayed).toBe(0);
    expect(s.dirtRegions.size).toBe(0);
  });
});

describe("tickFatigue", () => {
  it("ramps fatigue linearly from 0 to 1 over 90 minutes", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 45 * 60);
    expect(s.fatigue).toBeCloseTo(0.5, 2);
    s = tickFatigue(s, 45 * 60);
    expect(s.fatigue).toBeCloseTo(1, 2);
  });

  it("clamps fatigue at 1 even at 120 min (extra time)", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 120 * 60);
    expect(s.fatigue).toBe(1);
  });

  it("sweat tops out at the configured peak (default 0.6)", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 90 * 60);
    expect(s.sweat).toBeCloseTo(0.6, 2);
  });

  it("respects custom fullTimeMinutes", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 30 * 60, { fullTimeMinutes: 60 });
    expect(s.fatigue).toBeCloseTo(0.5, 2);
  });

  it("respects custom sweatPeak", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 90 * 60, { sweatPeak: 1.0 });
    expect(s.sweat).toBeCloseTo(1, 2);
  });

  it("advances matchClockSec independently of minutesPlayed", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 60 * 30);
    expect(s.matchClockSec).toBe(60 * 30);
    expect(s.minutesPlayed).toBe(30);
  });
});

describe("halfTimeBoost", () => {
  it("recovers fatigue and sweat by ~15%", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 45 * 60);
    const before = s.fatigue;
    s = halfTimeBoost(s);
    expect(s.fatigue).toBeCloseTo(before - 0.15, 3);
  });

  it("never goes below zero", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 60);
    s = halfTimeBoost(s, 0.5);
    expect(s.fatigue).toBe(0);
    expect(s.sweat).toBe(0);
  });
});

describe("addDirt", () => {
  it("adds a region without mutating the input set", () => {
    const a = createFatigueState();
    const b = addDirt(a, "torso_front");
    expect(a.dirtRegions.has("torso_front")).toBe(false);
    expect(b.dirtRegions.has("torso_front")).toBe(true);
  });

  it("idempotent for repeated regions", () => {
    let s = createFatigueState();
    s = addDirt(s, "shorts");
    s = addDirt(s, "shorts");
    expect(s.dirtRegions.size).toBe(1);
  });

  it("supports all four canonical regions", () => {
    let s = createFatigueState();
    s = addDirt(s, "torso_front");
    s = addDirt(s, "torso_back");
    s = addDirt(s, "shorts");
    s = addDirt(s, "socks");
    expect(s.dirtRegions.size).toBe(4);
  });
});

describe("applySweatToMaterial", () => {
  it("at sweat=0, roughness equals the base roughness", () => {
    const mat: MaterialLike = { roughness: 0.65 };
    applySweatToMaterial(mat, 0);
    expect(mat.roughness).toBeCloseTo(0.65, 5);
  });

  it("at sweat=1, roughness drops by 0.4", () => {
    const mat: MaterialLike = { roughness: 0.65 };
    applySweatToMaterial(mat, 1);
    expect(mat.roughness).toBeCloseTo(0.25, 5);
  });

  it("envMapIntensity scales with sweat", () => {
    const mat: MaterialLike = { roughness: 0.65, envMapIntensity: 1 };
    applySweatToMaterial(mat, 1);
    expect(mat.envMapIntensity).toBeCloseTo(1.5, 5);
  });

  it("clamps sweat input to [0, 1]", () => {
    const mat: MaterialLike = { roughness: 0.65 };
    applySweatToMaterial(mat, 5);
    expect(mat.roughness).toBeCloseTo(0.25, 5);
    applySweatToMaterial(mat, -2);
    expect(mat.roughness).toBeCloseTo(0.65, 5);
  });
});

describe("applyDirtToMaterial", () => {
  it("at dirt=0, matches base roughness", () => {
    const mat: MaterialLike = { roughness: 0 };
    applyDirtToMaterial(mat, 0);
    expect(mat.roughness).toBeCloseTo(0.7, 5);
  });

  it("at dirt=1, roughness rises to ~0.95", () => {
    const mat: MaterialLike = { roughness: 0 };
    applyDirtToMaterial(mat, 1);
    expect(mat.roughness).toBeCloseTo(0.95, 5);
  });

  it("envMapIntensity decreases with dirt", () => {
    const mat: MaterialLike = { roughness: 0, envMapIntensity: 1 };
    applyDirtToMaterial(mat, 1);
    expect(mat.envMapIntensity).toBeCloseTo(0.6, 5);
  });
});

describe("fatigueShaderEnabled", () => {
  it("only enabled at HIGH quality", () => {
    expect(fatigueShaderEnabled("high")).toBe(true);
    expect(fatigueShaderEnabled("medium")).toBe(false);
    expect(fatigueShaderEnabled("low")).toBe(false);
    expect(fatigueShaderEnabled(undefined)).toBe(false);
  });
});

describe("shouldSuggestSubstitution", () => {
  it("returns false for fresh players", () => {
    const s = createFatigueState();
    expect(shouldSuggestSubstitution(s)).toBe(false);
  });

  it("returns true above 0.85 fatigue and 60 minutes played", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 80 * 60);
    expect(shouldSuggestSubstitution(s)).toBe(true);
  });

  it("respects the minimum 60-minute floor", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 50 * 60, { fullTimeMinutes: 55 });
    expect(s.fatigue).toBeGreaterThan(0.85);
    expect(shouldSuggestSubstitution(s)).toBe(false);
  });

  it("respects a custom threshold", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 70 * 60);
    expect(shouldSuggestSubstitution(s, 0.9)).toBe(false);
    expect(shouldSuggestSubstitution(s, 0.7)).toBe(true);
  });
});

describe("fatigueSubstitutionBias", () => {
  it("returns 0 below 0.7 fatigue", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 30 * 60);
    expect(fatigueSubstitutionBias(s)).toBe(0);
  });

  it("returns 0..1 ramp above 0.7", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 81 * 60);
    const bias = fatigueSubstitutionBias(s);
    expect(bias).toBeGreaterThan(0);
    expect(bias).toBeLessThanOrEqual(1);
  });

  it("returns 1.0 at full fatigue", () => {
    let s = createFatigueState();
    s = tickFatigue(s, 90 * 60);
    expect(fatigueSubstitutionBias(s)).toBeCloseTo(1, 3);
  });
});

describe("createSweatUniforms", () => {
  it("returns the expected uniform shape with default zeros", () => {
    const u = createSweatUniforms();
    expect(u.uSweat).toEqual({ value: 0 });
    expect(u.uDirt).toEqual({ value: 0 });
  });

  it("respects initial values", () => {
    const u = createSweatUniforms(0.5, 0.2);
    expect(u.uSweat.value).toBe(0.5);
    expect(u.uDirt.value).toBe(0.2);
  });
});

describe("SWEAT_SHADER_FRAGMENT_CHUNK", () => {
  it("references both uSweat and uDirt uniforms", () => {
    expect(SWEAT_SHADER_FRAGMENT_CHUNK).toContain("uSweat");
    expect(SWEAT_SHADER_FRAGMENT_CHUNK).toContain("uDirt");
  });

  it("scales roughnessFactor by the wetness term", () => {
    expect(SWEAT_SHADER_FRAGMENT_CHUNK).toContain("roughnessFactor");
  });
});
