import { describe, it, expect } from "vitest";

import factory from "./index";

const ctx = {} as never;

describe("hello-scorer", () => {
  it("awards 10 points per correct prediction, 0 per wrong", () => {
    const { scorer } = factory(ctx);
    const bracket = {
      bracketId: "b1",
      userId: "u1",
      mode: "bracket" as const,
      predictions: [
        { matchId: "m1", outcome: "home_win" as const, lockedAtMs: 0 },
        { matchId: "m2", outcome: "draw" as const, lockedAtMs: 0 },
        { matchId: "m3", outcome: "away_win" as const, lockedAtMs: 0 },
      ],
    };
    const results = {
      actual: {
        m1: "home_win", // correct → 10
        m2: "home_win", // wrong → 0
        m3: "away_win", // correct → 10
      },
    };
    const breakdown = scorer.score(bracket, results, {});
    expect(breakdown.total).toBe(20);
    expect(breakdown.perPrediction.m1.points).toBe(10);
    expect(breakdown.perPrediction.m2.points).toBe(0);
    expect(breakdown.perPrediction.m3.points).toBe(10);
  });
});
