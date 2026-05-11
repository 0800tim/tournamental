/**
 * Unit tests for the Phase-3 crowd instance generator.
 *
 * Pure data, no Three. Verifies layout invariants:
 *   - Total instance count divides evenly across stands.
 *   - Stands are placed on the correct sides of the pitch.
 *   - Tier rises are monotonic.
 *   - PRNG seed is deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  buildCrowdInstanceData,
  CROWD_DEFAULT_COUNT,
  CROWD_TIERS,
  mulberry32,
} from "@/lib/crowd-instances";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it("produces values in [0,1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("CROWD_TIERS", () => {
  it("exports the four conceptual stands", () => {
    expect(CROWD_TIERS).toEqual(["north", "south", "east", "west"]);
  });
});

describe("buildCrowdInstanceData", () => {
  const out = buildCrowdInstanceData({
    count: 4000,
    pitchLength: 100,
    pitchWidth: 64,
    seed: 42,
  });

  it("splits the total count evenly across the four stands", () => {
    expect(out.matrices).toHaveLength(4000);
    expect(out.countsPerStand.north).toBe(1000);
    expect(out.countsPerStand.south).toBe(1000);
    expect(out.countsPerStand.east).toBe(1000);
    expect(out.countsPerStand.west).toBe(1000);
  });

  it("places north-stand instances on positive Z", () => {
    const north = out.matrices.filter((m) => m.stand === "north");
    expect(north.length).toBeGreaterThan(0);
    for (const m of north) expect(m.z).toBeGreaterThan(0);
  });

  it("places south-stand instances on negative Z", () => {
    const south = out.matrices.filter((m) => m.stand === "south");
    for (const m of south) expect(m.z).toBeLessThan(0);
  });

  it("places east-stand instances on positive X", () => {
    const east = out.matrices.filter((m) => m.stand === "east");
    for (const m of east) expect(m.x).toBeGreaterThan(0);
  });

  it("places west-stand instances on negative X", () => {
    const west = out.matrices.filter((m) => m.stand === "west");
    for (const m of west) expect(m.x).toBeLessThan(0);
  });

  it("tier indices are 0, 1, or 2", () => {
    for (const m of out.matrices)
      expect([0, 1, 2]).toContain(m.tier);
  });

  it("higher tiers are higher in Y", () => {
    const tier0 = out.matrices.filter((m) => m.tier === 0).map((m) => m.y);
    const tier1 = out.matrices.filter((m) => m.tier === 1).map((m) => m.y);
    const tier2 = out.matrices.filter((m) => m.tier === 2).map((m) => m.y);
    expect(Math.min(...tier1)).toBeGreaterThan(Math.max(...tier0) - 0.001);
    expect(Math.min(...tier2)).toBeGreaterThan(Math.max(...tier1) - 0.001);
  });

  it("layout is deterministic for a fixed seed", () => {
    const a = buildCrowdInstanceData({
      count: 100,
      pitchLength: 100,
      pitchWidth: 64,
      seed: 99,
    });
    const b = buildCrowdInstanceData({
      count: 100,
      pitchLength: 100,
      pitchWidth: 64,
      seed: 99,
    });
    for (let i = 0; i < a.matrices.length; i++) {
      expect(a.matrices[i].x).toBe(b.matrices[i].x);
      expect(a.matrices[i].z).toBe(b.matrices[i].z);
      expect(a.matrices[i].colourHex).toBe(b.matrices[i].colourHex);
    }
  });

  it("default count is 5,000", () => {
    expect(CROWD_DEFAULT_COUNT).toBe(5000);
  });

  it("each instance gets a phase in [0,1)", () => {
    for (const m of out.matrices) {
      expect(m.phase).toBeGreaterThanOrEqual(0);
      expect(m.phase).toBeLessThan(1);
    }
  });

  it("each colour is one of the stand's palette", () => {
    const palettes: Record<string, number[]> = {
      north: [0x1c5fbf, 0x2880e0, 0x5fa3ee],
      south: [0xc02427, 0xe14245, 0xf7706f],
      east: [0xe9a200, 0xf7c64a, 0xfddc8a],
      west: [0xe9a200, 0xf7c64a, 0xfddc8a],
    };
    for (const m of out.matrices) {
      expect(palettes[m.stand]).toContain(m.colourHex);
    }
  });
});
