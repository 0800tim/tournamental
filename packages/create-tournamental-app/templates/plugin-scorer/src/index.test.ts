import { describe, it, expect } from "vitest";

import factory from "./index";

const ctx = {} as never;

describe("__PKG_DISPLAY__", () => {
  it("awards 10 points per correct prediction", () => {
    const { scorer } = factory(ctx);
    const bracket = {
      bracketId: "b1",
      userId: "u1",
      mode: "bracket" as const,
      predictions: [
        { matchId: "m1", outcome: "home_win" as const, lockedAtMs: 0 },
        { matchId: "m2", outcome: "draw" as const, lockedAtMs: 0 },
      ],
    };
    const results = { actual: { m1: "home_win", m2: "away_win" } };
    const r = scorer.score(bracket, results, {});
    expect(r.total).toBe(10);
    expect(r.perPrediction.m1.points).toBe(10);
    expect(r.perPrediction.m2.points).toBe(0);
  });
});
