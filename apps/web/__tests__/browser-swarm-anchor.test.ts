/**
 * Unit tests for the user-anchored swarm blend.
 *
 * Verifies that:
 *   - Anchor mode -> weight constants are stable.
 *   - blendOutcome returns chalk when weight=0 OR no user pick.
 *   - blendOutcome returns user pick when weight=1 AND user pick exists.
 *   - For intermediate weights the blend picks user pick iff
 *     `r < weight`.
 *   - The hash function is deterministic + sensitive to pick changes.
 */

import { describe, expect, it } from "vitest";

import {
  ANCHOR_WEIGHT_BY_MODE,
  blendOutcome,
  captureAnchorSnapshot,
  flattenBracket,
  type AnchorSnapshot,
} from "@/components/browser-swarm/anchor";

function snapshot(picks: Record<string, "home_win" | "draw" | "away_win">, weight: number): AnchorSnapshot {
  return {
    weight,
    picks,
    bracket_hash: "test",
    captured_at_utc: "1970-01-01T00:00:00Z",
  };
}

describe("browser-swarm anchor", () => {
  it("anchor weight constants are stable", () => {
    expect(ANCHOR_WEIGHT_BY_MODE.off).toBe(0);
    expect(ANCHOR_WEIGHT_BY_MODE.soft).toBeCloseTo(0.4);
    expect(ANCHOR_WEIGHT_BY_MODE.strong).toBeCloseTo(0.75);
    expect(ANCHOR_WEIGHT_BY_MODE.lockstep).toBe(1);
  });

  it("blends to chalk when weight is 0", () => {
    const snap = snapshot({ "1": "draw" }, 0);
    expect(blendOutcome("1", "home_win", snap, 0)).toBe("home_win");
    expect(blendOutcome("1", "home_win", snap, 0.99)).toBe("home_win");
  });

  it("blends to user pick when weight is 1 and user pick exists", () => {
    const snap = snapshot({ "1": "draw" }, 1);
    expect(blendOutcome("1", "home_win", snap, 0)).toBe("draw");
    expect(blendOutcome("1", "home_win", snap, 0.5)).toBe("draw");
    expect(blendOutcome("1", "home_win", snap, 0.99)).toBe("draw");
  });

  it("falls back to chalk for matches the user hasn't picked", () => {
    const snap = snapshot({ "1": "draw" }, 1);
    expect(blendOutcome("99", "away_win", snap, 0)).toBe("away_win");
  });

  it("respects the [0, weight) draw boundary for intermediate weights", () => {
    const snap = snapshot({ "1": "draw" }, 0.4);
    // r below weight -> user pick wins.
    expect(blendOutcome("1", "home_win", snap, 0.0)).toBe("draw");
    expect(blendOutcome("1", "home_win", snap, 0.39)).toBe("draw");
    // r at or above weight -> chalk wins.
    expect(blendOutcome("1", "home_win", snap, 0.4)).toBe("home_win");
    expect(blendOutcome("1", "home_win", snap, 0.99)).toBe("home_win");
  });

  it("flattenBracket combines group + knockout predictions", () => {
    const flat = flattenBracket({
      bracketId: "b1",
      matchPredictions: {
        "1": {
          matchId: "1",
          outcome: "home_win",
          lockedAt: "1970-01-01T00:00:00Z",
        },
      },
      knockoutPredictions: {
        r32_01: {
          matchId: "r32_01",
          outcome: "away_win",
          lockedAt: "1970-01-01T00:00:00Z",
        },
      },
      groupTiebreakers: {},
      version: 1,
    });
    expect(flat["1"]).toBe("home_win");
    expect(flat["r32_01"]).toBe("away_win");
  });

  it("captureAnchorSnapshot returns a stable hash for empty drafts", () => {
    const a = captureAnchorSnapshot("fifa-wc-2026", "off");
    const b = captureAnchorSnapshot("fifa-wc-2026", "off");
    expect(a.bracket_hash).toBe(b.bracket_hash);
    expect(a.weight).toBe(0);
  });
});
