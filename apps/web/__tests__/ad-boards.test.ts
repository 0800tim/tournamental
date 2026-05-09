/**
 * Unit tests for the rotating LED ad-board layout.
 */
import { describe, expect, it } from "vitest";
import {
  AD_BOARD_COLOURS,
  AD_BOARD_COUNT,
  AD_BOARD_HEIGHT,
  AD_BOARD_NAMES,
  AD_BOARD_OFFSET,
  AD_BOARD_WIDTH,
  AD_CYCLE_SECONDS,
  buildAdBoardLayout,
} from "@/lib/ad-boards";

describe("AD_BOARD_NAMES", () => {
  it("has 16 sponsor placeholders", () => {
    expect(AD_BOARD_NAMES).toHaveLength(16);
  });

  it("each name is a non-empty string", () => {
    for (const n of AD_BOARD_NAMES) {
      expect(typeof n).toBe("string");
      expect(n.length).toBeGreaterThan(0);
    }
  });

  it("colours are paired with names 1:1", () => {
    expect(AD_BOARD_COLOURS).toHaveLength(AD_BOARD_NAMES.length);
    for (const c of AD_BOARD_COLOURS) {
      expect(c.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("buildAdBoardLayout (default)", () => {
  const boards = buildAdBoardLayout();

  it("has the configured count", () => {
    expect(boards).toHaveLength(AD_BOARD_COUNT);
  });

  it("uses the configured size", () => {
    for (const b of boards) {
      expect(b.size[0]).toBe(AD_BOARD_WIDTH);
      expect(b.size[1]).toBe(AD_BOARD_HEIGHT);
    }
  });

  it("places boards along the touchline", () => {
    // Default: 100m × 64m pitch with 1.6m offset.
    // Long sides expected: 10 each (positive Z + negative Z).
    const north = boards.filter((b) => b.position[2] > 30);
    const south = boards.filter((b) => b.position[2] < -30);
    const east = boards.filter((b) => b.position[0] > 50);
    const west = boards.filter((b) => b.position[0] < -50);
    expect(north.length).toBe(10);
    expect(south.length).toBe(10);
    expect(east.length).toBe(6);
    expect(west.length).toBe(6);
    // Total per spec: 32.
    expect(north.length + south.length + east.length + west.length).toBe(32);
  });

  it("y-position is at half the board height (centred)", () => {
    for (const b of boards) {
      expect(b.position[1]).toBeCloseTo(AD_BOARD_HEIGHT / 2, 5);
    }
  });

  it("yaws boards to face the pitch", () => {
    for (const b of boards) {
      // Just check it's one of the cardinal yaws.
      const rounded = Math.round((b.yaw * 2) / Math.PI);
      expect([-1, 0, 1, 2, -2]).toContain(rounded);
    }
  });

  it("stand offsets are at least the configured offset beyond the touchline", () => {
    const halfL = 50;
    const halfW = 32;
    for (const b of boards) {
      const offX = Math.abs(b.position[0]) - halfL;
      const offZ = Math.abs(b.position[2]) - halfW;
      // One of the two should be ~ AD_BOARD_OFFSET — whichever side
      // the board sits on.
      const hits =
        Math.abs(offX - AD_BOARD_OFFSET) < 0.01 ||
        Math.abs(offZ - AD_BOARD_OFFSET) < 0.01;
      expect(hits).toBe(true);
    }
  });

  it("initial tile cycles through the name list", () => {
    const tiles = boards.map((b) => b.initialTile);
    const unique = new Set(tiles);
    // We have 32 boards and 16 names so each tile appears at least once.
    expect(unique.size).toBe(16);
  });
});

describe("buildAdBoardLayout (override count)", () => {
  it("respects the count override (rounded to per-side splits)", () => {
    const out = buildAdBoardLayout({ count: 16 });
    // 16 → 5 long + 5 long + 3 short + 3 short = 16 total
    expect(out.length).toBe(16);
  });
});

describe("AD_CYCLE_SECONDS", () => {
  it("is 15 seconds per spec", () => {
    expect(AD_CYCLE_SECONDS).toBe(15);
  });
});
