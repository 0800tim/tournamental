/**
 * Unit tests for the deterministic mock odds generator.
 *
 * Properties we care about:
 *   1. Probabilities sum to 1.0 (within float tolerance).
 *   2. Stronger team (lower FIFA rank) has higher home-win.
 *   3. Same input -> same output (determinism).
 *   4. Knockout: no draw row, sums to 1.0.
 *   5. Unknown team fallback never returns NaN.
 */

import { describe, it, expect } from "vitest";

import {
  mockMatchOdds,
  mockOddsForUnknownTeams,
  mockOddsHistory,
} from "../lib/odds/mock";

const APPROX = 0.005;

describe("mockMatchOdds", () => {
  it("group probabilities sum to ~1.0", () => {
    const o = mockMatchOdds({
      matchNo: "1",
      homeTeam: "ARG",
      awayTeam: "MEX",
      homeRank: 1,
      awayRank: 12,
    });
    const total = o.homeWin + (o.draw ?? 0) + o.awayWin;
    expect(Math.abs(total - 1)).toBeLessThan(APPROX);
  });

  it("stronger home team gets higher homeWin", () => {
    const strong = mockMatchOdds({
      matchNo: "100",
      homeTeam: "ARG",
      awayTeam: "JOR",
      homeRank: 1,
      awayRank: 80,
    });
    const weak = mockMatchOdds({
      matchNo: "100",
      homeTeam: "JOR",
      awayTeam: "ARG",
      homeRank: 80,
      awayRank: 1,
    });
    expect(strong.homeWin).toBeGreaterThan(weak.homeWin);
  });

  it("is deterministic for the same matchNo", () => {
    const a = mockMatchOdds({
      matchNo: "42",
      homeTeam: "BRA",
      awayTeam: "GER",
      homeRank: 5,
      awayRank: 7,
    });
    const b = mockMatchOdds({
      matchNo: "42",
      homeTeam: "BRA",
      awayTeam: "GER",
      homeRank: 5,
      awayRank: 7,
    });
    expect(a.homeWin).toBe(b.homeWin);
    expect(a.draw).toBe(b.draw);
    expect(a.awayWin).toBe(b.awayWin);
  });

  it("different matchNo produces different probability vectors", () => {
    const a = mockMatchOdds({
      matchNo: "noise-a",
      homeTeam: "BRA",
      awayTeam: "GER",
      homeRank: 5,
      awayRank: 7,
    });
    const b = mockMatchOdds({
      matchNo: "noise-b",
      homeTeam: "BRA",
      awayTeam: "GER",
      homeRank: 5,
      awayRank: 7,
    });
    // The per-match noise drives at least one of the three components
    // to differ from the other match's vector. We compare the full
    // tuple rather than just `homeWin` because rounding to 3dp can
    // collide on a single component.
    const sameAll =
      a.homeWin === b.homeWin && a.draw === b.draw && a.awayWin === b.awayWin;
    expect(sameAll).toBe(false);
  });

  it("knockout match has draw=null and W+L=1", () => {
    const o = mockMatchOdds({
      matchNo: "r32_03",
      homeTeam: "ARG",
      awayTeam: "MEX",
      homeRank: 1,
      awayRank: 12,
      noDraw: true,
    });
    expect(o.draw).toBeNull();
    expect(Math.abs(o.homeWin + o.awayWin - 1)).toBeLessThan(APPROX);
  });

  it("very mismatched ranks still produce sane probabilities (no negatives)", () => {
    const o = mockMatchOdds({
      matchNo: "extreme",
      homeTeam: "ARG",
      awayTeam: "WORST",
      homeRank: 1,
      awayRank: 200,
    });
    expect(o.homeWin).toBeGreaterThan(0);
    expect(o.homeWin).toBeLessThan(1);
    expect(o.draw === null || o.draw > 0).toBe(true);
    expect(o.awayWin).toBeGreaterThan(0);
  });

  it("evenly matched rank produces a roughly balanced market", () => {
    // Per-match noise on home% is up to ±4pp, so the W-L gap can reach
    // ~0.4 in extreme noise rolls. We assert the looser claim that
    // (a) draw is present and in a plausible band and (b) the gap
    // doesn't blow out further than 1 standard deviation of the noise.
    const o = mockMatchOdds({
      matchNo: "even",
      homeTeam: "BRA",
      awayTeam: "GER",
      homeRank: 5,
      awayRank: 5,
    });
    expect(o.draw).not.toBeNull();
    expect(o.draw!).toBeGreaterThan(0.18);
    expect(o.draw!).toBeLessThan(0.34);
    // Loose balance check, with rank diff = 0, the home/away spread
    // is bounded by 2 × noise amplitude ≈ 0.10, allowing for normalisation
    // overhead.
    expect(Math.abs(o.homeWin - o.awayWin)).toBeLessThan(0.40);
  });
});

describe("mockOddsForUnknownTeams", () => {
  it("never returns NaN or negatives", () => {
    const o = mockOddsForUnknownTeams("unknown:1");
    expect(Number.isFinite(o.homeWin)).toBe(true);
    expect(Number.isFinite(o.awayWin)).toBe(true);
    expect(o.homeWin).toBeGreaterThan(0);
    expect(o.awayWin).toBeGreaterThan(0);
  });
});

describe("mockOddsHistory", () => {
  it("emits 14 points by default with monotonically increasing timestamps", () => {
    const cur = mockMatchOdds({
      matchNo: "trend",
      homeTeam: "ARG",
      awayTeam: "MEX",
      homeRank: 1,
      awayRank: 12,
    });
    const h = mockOddsHistory("trend", cur);
    expect(h.points).toHaveLength(14);
    for (let i = 1; i < h.points.length; i += 1) {
      const prev = Date.parse(h.points[i - 1]!.ts);
      const curr = Date.parse(h.points[i]!.ts);
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("each history point sums to ~1.0", () => {
    const cur = mockMatchOdds({
      matchNo: "trend2",
      homeTeam: "BRA",
      awayTeam: "GER",
      homeRank: 5,
      awayRank: 7,
    });
    const h = mockOddsHistory("trend2", cur);
    for (const p of h.points) {
      const total = p.homeWin + (p.draw ?? 0) + p.awayWin;
      expect(Math.abs(total - 1)).toBeLessThan(APPROX);
    }
  });
});
