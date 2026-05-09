import { describe, expect, it } from "vitest";

import { computeBracketScore } from "../src/scoring/recompute.js";
import type { MatchOutcome } from "../src/types.js";
import { makeBracket, makeMatchPrediction } from "./helpers.js";

describe("computeBracketScore", () => {
  it("returns zero for an unsettled bracket", () => {
    const bracket = makeBracket("bk_zero", {
      "1": makeMatchPrediction("1", "home_win"),
    });
    const out = computeBracketScore({ bracket, results: new Map() });
    expect(out.total).toBe(0);
    expect(out.perMatch.length).toBe(0);
  });

  it("scores a correct group-stage outcome with positive points", () => {
    const bracket = makeBracket("bk_correct", {
      "1": makeMatchPrediction("1", "home_win"),
    });
    const results = new Map<string, MatchOutcome>([
      [
        "1",
        {
          outcome: "home_win",
          stage: "group",
          impliedAtLock: 0.5,
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const out = computeBracketScore({ bracket, results });
    expect(out.total).toBeGreaterThan(0);
    expect(out.perMatch[0].matchId).toBe("1");
  });

  it("rewards exact-score predictions over outcome-only", () => {
    const exact = makeBracket("bk_exact", {
      "1": makeMatchPrediction("1", "home_win", { homeScore: 2, awayScore: 1 }),
    });
    const outcomeOnly = makeBracket("bk_outcome", {
      "1": makeMatchPrediction("1", "home_win"),
    });
    const results = new Map<string, MatchOutcome>([
      [
        "1",
        {
          outcome: "home_win",
          homeScore: 2,
          awayScore: 1,
          stage: "group",
          impliedAtLock: 0.5,
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const exactScore = computeBracketScore({ bracket: exact, results });
    const outcomeScore = computeBracketScore({ bracket: outcomeOnly, results });
    expect(exactScore.total).toBeGreaterThan(outcomeScore.total);
  });

  it("scores zero for a wrong outcome regardless of multipliers", () => {
    const bracket = makeBracket("bk_wrong", {
      "1": makeMatchPrediction("1", "draw"),
    });
    const results = new Map<string, MatchOutcome>([
      [
        "1",
        {
          outcome: "home_win",
          stage: "group",
          impliedAtLock: 0.05, // big contrarian multiplier should be ignored
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const out = computeBracketScore({ bracket, results });
    expect(out.total).toBe(0);
  });

  it("contrarian picks earn more than chalk picks for the same correctness", () => {
    const bracket = makeBracket("bk", {
      "1": makeMatchPrediction("1", "home_win"),
    });
    const chalk: Map<string, MatchOutcome> = new Map([
      [
        "1",
        {
          outcome: "home_win",
          stage: "group",
          impliedAtLock: 0.8,
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const longshot: Map<string, MatchOutcome> = new Map([
      [
        "1",
        {
          outcome: "home_win",
          stage: "group",
          impliedAtLock: 0.04,
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const chalkOut = computeBracketScore({ bracket, results: chalk });
    const longshotOut = computeBracketScore({ bracket, results: longshot });
    expect(longshotOut.total).toBeGreaterThan(chalkOut.total);
  });

  it("scores a knockout pick when the predicted outcome label matches", () => {
    const bracket = makeBracket(
      "bk_ko",
      {},
      {
        "r16_3": makeMatchPrediction("r16_3", "home_win"),
      },
    );
    const results = new Map<string, MatchOutcome>([
      [
        "r16_3",
        {
          outcome: "home_win",
          stage: "r16",
          winner: "ARG",
          impliedAtLock: 0.4,
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const out = computeBracketScore({ bracket, results });
    expect(out.total).toBeGreaterThan(0);
  });

  it("does not double-count when the same match is in both prediction maps", () => {
    const bracket = makeBracket(
      "bk_dual",
      { "9": makeMatchPrediction("9", "home_win") },
      { "9": makeMatchPrediction("9", "home_win") },
    );
    const results = new Map<string, MatchOutcome>([
      [
        "9",
        {
          outcome: "home_win",
          stage: "group",
          impliedAtLock: 0.5,
          secondsSinceLock: 0,
          windowSeconds: 30 * 24 * 60 * 60,
        },
      ],
    ]);
    const out = computeBracketScore({ bracket, results });
    // The recomputer prefers `matchPredictions` for stage='group'; the
    // knockout entry is silently ignored. We just check we got a single
    // line item, not two.
    expect(out.perMatch.length).toBe(1);
  });
});
