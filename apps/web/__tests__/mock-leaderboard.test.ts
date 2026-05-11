/**
 * Vitest, determinism + shape of mock leaderboard generators.
 *
 * The "real data day" swap-out is a single import swap; before that
 * happens, the generators are the load-bearing seed for every demo
 * surface. They MUST be deterministic across re-renders, processes,
 * and snapshot tests.
 */

import { describe, expect, it } from "vitest";

import { mockLeaderboardMembers, mockTopN } from "@/lib/mock/leaderboard";
import { mockPointsHistory, mockPoolAverage } from "@/lib/mock/points-history";
import {
  MOCK_SYNDICATES,
  findSyndicate,
  mockActivityFeed,
} from "@/lib/mock/syndicate";
import { hashSeed, mulberry32, seededRng, shuffle } from "@/lib/mock/rng";

describe("mock leaderboard determinism", () => {
  it("returns the same members for the same syndicate seed", () => {
    const a = mockLeaderboardMembers("magnus-pool", 20);
    const b = mockLeaderboardMembers("magnus-pool", 20);
    expect(a).toEqual(b);
  });

  it("returns different members for different seeds", () => {
    const a = mockLeaderboardMembers("magnus-pool", 20);
    const b = mockLeaderboardMembers("london-pundits", 20);
    // Top member should differ, same names pool, different shuffle.
    expect(a[0]?.handle === b[0]?.handle && a[1]?.handle === b[1]?.handle).toBe(false);
  });

  it("returns exactly `count` rows when the names pool is large enough", () => {
    expect(mockLeaderboardMembers(null, 25)).toHaveLength(25);
  });

  it("caps the count at the names-pool size", () => {
    const rows = mockLeaderboardMembers(null, 999);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.length).toBeLessThanOrEqual(60);
  });

  it("orders rows by rank 1..N with descending or equal points", () => {
    const rows = mockLeaderboardMembers("auckland-footy-bunch", 20);
    rows.forEach((m, idx) => {
      expect(m.rank).toBe(idx + 1);
    });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.points).toBeGreaterThanOrEqual(rows[i]!.points - 5);
    }
  });

  it("compresses the top 3 gap to <= 30 points", () => {
    const rows = mockLeaderboardMembers("office-wc-2026", 10);
    expect(rows[0]!.points - rows[2]!.points).toBeLessThanOrEqual(30);
  });

  it("mockTopN matches the first N of mockLeaderboardMembers", () => {
    const all = mockLeaderboardMembers(null, 50);
    const top = mockTopN(null, 10);
    expect(top).toEqual(all.slice(0, 10));
  });

  it("assigns the syndicate-owner badge to rank 1", () => {
    const rows = mockLeaderboardMembers("tackle-house", 10);
    expect(rows[0]!.badge).toBe("syndicate-owner");
  });
});

describe("mock points history", () => {
  it("returns the requested length", () => {
    expect(mockPointsHistory("seed-a", 7)).toHaveLength(7);
    expect(mockPointsHistory("seed-a", 36)).toHaveLength(36);
  });

  it("is monotonically non-decreasing", () => {
    const series = mockPointsHistory("seed-a", 20);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.points).toBeGreaterThanOrEqual(series[i - 1]!.points);
    }
  });

  it("is deterministic for the same seed", () => {
    const a = mockPointsHistory("seed-x", 12);
    const b = mockPointsHistory("seed-x", 12);
    expect(a).toEqual(b);
  });

  it("pool average lags the member series", () => {
    const m = mockPointsHistory("seed-x", 12);
    const p = mockPoolAverage("seed-x", 12);
    expect(p[p.length - 1]!.points).toBeLessThan(m[m.length - 1]!.points);
  });
});

describe("mock syndicates", () => {
  it("ships six baked examples", () => {
    expect(MOCK_SYNDICATES).toHaveLength(6);
  });

  it("findSyndicate resolves a known slug", () => {
    expect(findSyndicate("magnus-pool")?.name).toBe("Magnus's Pool");
    expect(findSyndicate("does-not-exist")).toBeUndefined();
  });

  it("activity feed returns 8 events with stable ids", () => {
    const a = mockActivityFeed("magnus-pool");
    const b = mockActivityFeed("magnus-pool");
    expect(a).toHaveLength(8);
    expect(a).toEqual(b);
  });

  it("every syndicate has a vibe palette", () => {
    for (const s of MOCK_SYNDICATES) {
      expect(s.vibePalette.primary).toMatch(/^#/);
      expect(s.vibePalette.accent).toMatch(/^#/);
    }
  });
});

describe("rng helpers", () => {
  it("hashSeed returns a stable non-zero integer for any string", () => {
    expect(hashSeed("a")).toBe(hashSeed("a"));
    expect(hashSeed("")).not.toBe(0);
  });

  it("mulberry32 generates the same stream from the same seed", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) expect(a()).toBeCloseTo(b(), 12);
  });

  it("shuffle is a permutation and deterministic", () => {
    const items = [1, 2, 3, 4, 5];
    const a = shuffle(items, seededRng("x"));
    const b = shuffle(items, seededRng("x"));
    expect(a.slice().sort()).toEqual(items);
    expect(a).toEqual(b);
  });
});
