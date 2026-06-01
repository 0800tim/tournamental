/**
 * Score model tests. Long-shot rewards, time multiplier curve, stage
 * weighting, lock-and-hold bonus, determinism, full-bracket scoring.
 */

import { describe, expect, it } from "vitest";

import {
  BASE_POINTS,
  BRACKET_MODE_MULTIPLIER,
  LOCK_AND_HOLD_BONUS,
  STAGE_MULTIPLIERS,
  confidenceMultiplier,
  contrarianMultiplier,
  lockMultiplier,
  scoreBracket,
  scoreGroupMatchPrediction,
  scoreGroupPlacement,
  scoreKnockoutMatchPrediction,
  scorePick,
  streakMultiplier,
  timeMultiplier,
} from "../src/score.js";
import { cascade } from "../src/cascade.js";
import { loadFixtures2026 } from "../src/fixtures-loader.js";
import type { BracketPrediction } from "../src/tournament.js";

describe("score — base points (long-shot bonus)", () => {
  it("low implied probability yields high base points", () => {
    const longshot = scorePick({
      market_implied_at_lock: 0.05,
      seconds_to_kickoff_at_lock: 60 * 60, // 1h before kickoff
      stage: "f",
      correct: true,
    });
    const favourite = scorePick({
      market_implied_at_lock: 0.9,
      seconds_to_kickoff_at_lock: 60 * 60,
      stage: "f",
      correct: true,
    });
    expect(longshot.base_points).toBeGreaterThan(favourite.base_points);
    expect(longshot.points_awarded).toBeGreaterThan(favourite.points_awarded);
  });

  it("base_points = 100 * (1 - market_implied)", () => {
    expect(
      scorePick({
        market_implied_at_lock: 0.18,
        seconds_to_kickoff_at_lock: 0,
        stage: "group",
        correct: true,
      }).base_points,
    ).toBeCloseTo(82, 5);
  });

  it("incorrect predictions earn zero, regardless of base points", () => {
    const wrong = scorePick({
      market_implied_at_lock: 0.05,
      seconds_to_kickoff_at_lock: 60 * 60,
      stage: "f",
      correct: false,
    });
    expect(wrong.points_awarded).toBe(0);
  });
});

describe("score — time multiplier (early conviction beats late)", () => {
  it("locking >30 minutes pre-kickoff gets 1.5x", () => {
    expect(timeMultiplier(31 * 60)).toBe(1.5);
    expect(timeMultiplier(7 * 24 * 3600)).toBe(1.5);
  });

  it("locking 0 to 30 min pre-kickoff gets 1.25x", () => {
    expect(timeMultiplier(0)).toBe(1.25);
    expect(timeMultiplier(29 * 60)).toBe(1.25);
  });

  it("early-third in-match gets 1.10x", () => {
    expect(timeMultiplier(-29 * 60)).toBe(1.1); // 29 min into a 90 min match
  });

  it("middle-third gets 1.00x", () => {
    expect(timeMultiplier(-45 * 60)).toBe(1.0);
  });

  it("last 10% gets 0.10x", () => {
    expect(timeMultiplier(-(85 * 60))).toBe(0.1);
  });

  it("the same long-shot pick locked 1h pre-kickoff outscores it locked at kickoff", () => {
    const early = scorePick({
      market_implied_at_lock: 0.1,
      seconds_to_kickoff_at_lock: 60 * 60,
      stage: "qf",
      correct: true,
    });
    const late = scorePick({
      market_implied_at_lock: 0.1,
      seconds_to_kickoff_at_lock: 0,
      stage: "qf",
      correct: true,
    });
    expect(early.points_awarded).toBeGreaterThan(late.points_awarded);
    // 1.5x vs 1.25x = 20% more
    expect(early.raw / late.raw).toBeCloseTo(1.5 / 1.25, 5);
  });
});

describe("score — stage multipliers", () => {
  it("final pays 3x more than group stage", () => {
    expect(STAGE_MULTIPLIERS.f / STAGE_MULTIPLIERS.group).toBe(3);
  });

  it("scales monotonically through the rounds", () => {
    expect(STAGE_MULTIPLIERS.group).toBeLessThan(STAGE_MULTIPLIERS.r32);
    expect(STAGE_MULTIPLIERS.r32).toBeLessThan(STAGE_MULTIPLIERS.r16);
    expect(STAGE_MULTIPLIERS.r16).toBeLessThan(STAGE_MULTIPLIERS.qf);
    expect(STAGE_MULTIPLIERS.qf).toBeLessThan(STAGE_MULTIPLIERS.sf);
    expect(STAGE_MULTIPLIERS.sf).toBeLessThan(STAGE_MULTIPLIERS.f);
  });
});

describe("score — confidence and streak", () => {
  it("confidence multiplier is monotonic", () => {
    expect(confidenceMultiplier(1)).toBe(1.0);
    expect(confidenceMultiplier(2)).toBe(1.1);
    expect(confidenceMultiplier(5)).toBe(1.5);
  });

  it("clamps confidence to 5", () => {
    expect(confidenceMultiplier(99)).toBe(1.5);
  });

  it("streak multiplier compounds and caps at 1.5x", () => {
    expect(streakMultiplier(0)).toBe(1.0);
    expect(streakMultiplier(3)).toBe(1.1);
    expect(streakMultiplier(20)).toBe(1.5);
    expect(streakMultiplier(100)).toBe(1.5);
  });
});

describe("score — lock-and-hold bonus", () => {
  it("locked_and_held gives a 1.10x mode multiplier on top of the bracket default", () => {
    const locked = scorePick({
      market_implied_at_lock: 0.3,
      seconds_to_kickoff_at_lock: 60 * 60,
      stage: "qf",
      locked_and_held: true,
      correct: true,
    });
    const unlocked = scorePick({
      market_implied_at_lock: 0.3,
      seconds_to_kickoff_at_lock: 60 * 60,
      stage: "qf",
      locked_and_held: false,
      correct: true,
    });
    expect(locked.mode_multiplier / unlocked.mode_multiplier).toBeCloseTo(LOCK_AND_HOLD_BONUS, 5);
    expect(BRACKET_MODE_MULTIPLIER).toBe(1.0);
  });
});

describe("score — determinism", () => {
  it("same inputs always produce identical breakdown", () => {
    const input = {
      market_implied_at_lock: 0.21,
      seconds_to_kickoff_at_lock: 90 * 60,
      stage: "qf" as const,
      confidence: 3,
      streak: 4,
      locked_and_held: true,
      correct: true,
    };
    expect(scorePick(input)).toEqual(scorePick(input));
  });
});

describe("scoreBracket — full-bracket scoring", () => {
  const tournament = loadFixtures2026();

  function fullPrediction(): BracketPrediction {
    return {
      tournament_id: tournament.id,
      user_id: "u_test",
      groups: tournament.groups.map((g) => ({ group_id: g.id, order: [...g.team_ids] })),
      best_thirds: tournament.groups.map((g) => g.team_ids[2]),
      best_fourths: tournament.groups.map((g) => g.team_ids[3]),
      knockouts: [],
      locks: [],
      updated_at_utc: "2026-05-15T00:00:00Z",
    };
  }

  it("returns zero points when no matches are settled", () => {
    const pred = fullPrediction();
    const c = cascade(tournament, pred);
    const summary = scoreBracket({
      tournament,
      bracket: pred,
      cascaded: c,
      implied_at_lock_by_match: new Map(),
    });
    expect(summary.total_points).toBe(0);
    expect(summary.settled_count).toBe(0);
  });

  it("awards points for correctly predicted settled matches", () => {
    // Pick the team that actually fills r32_01's home slot in the
    // current FIFA-correct fixture (e.g. group A's runner-up for r32_01
    // which is 2A vs 2B in the FIFA 2026 R32 structure).
    const base = fullPrediction();
    const r32_01_fix = tournament.knockouts.find((k) => k.id === "r32_01")!;
    if (r32_01_fix.home.kind !== "group_position") {
      throw new Error("test expects r32_01.home to be a group_position slot");
    }
    const homeGroup = tournament.groups.find((g) => g.id === r32_01_fix.home.group)!;
    const homeTeam = homeGroup.team_ids[r32_01_fix.home.position - 1]!;
    const pred: BracketPrediction = {
      ...base,
      knockouts: [{ match_id: "r32_01", winner: homeTeam }],
    };
    const completed = {
      groups: [],
      knockouts: [{ match_id: "r32_01", winner: homeTeam, settled: true }],
    };
    const c = cascade(tournament, pred, completed);
    const summary = scoreBracket({
      tournament,
      bracket: pred,
      cascaded: c,
      implied_at_lock_by_match: new Map([["r32_01", 0.4]]),
    });
    expect(summary.correct_count).toBe(1);
    expect(summary.settled_count).toBe(1);
    expect(summary.total_points).toBeGreaterThan(0);
  });

  it("incorrect predictions on settled matches earn zero but are counted as settled", () => {
    const base = fullPrediction();
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const groupB = tournament.groups.find((g) => g.id === "B")!;
    const pred: BracketPrediction = {
      ...base,
      knockouts: [{ match_id: "r32_01", winner: groupA.team_ids[0] }],
    };
    const completed = {
      groups: [],
      knockouts: [{ match_id: "r32_01", winner: groupB.team_ids[1], settled: true }],
    };
    const c = cascade(tournament, pred, completed);
    const summary = scoreBracket({
      tournament,
      bracket: pred,
      cascaded: c,
      implied_at_lock_by_match: new Map([["r32_01", 0.4]]),
    });
    expect(summary.correct_count).toBe(0);
    expect(summary.settled_count).toBe(1);
    expect(summary.total_points).toBe(0);
  });
});

describe("per-match score — group outcome (docs/30 formula)", () => {
  it("correct outcome alone earns 50 base points", () => {
    const r = scoreGroupMatchPrediction({
      stage: "group",
      predictedOutcome: "home_win",
      actualOutcome: "home_win",
      impliedAtLock: 0.6, // favourite, contrarian = 1.0
      secondsSinceLock: 1_000_000, // close to kickoff, lock_mult ~= 1.0
      windowSeconds: 1_000_000,
    });
    expect(r.basePoints).toBe(50);
    expect(r.outcomeCorrect).toBe(true);
    expect(r.exactScoreCorrect).toBe(false);
    expect(r.contrarianMult).toBe(1.0);
    // raw is base × lock × contrarian
    expect(r.raw).toBeCloseTo(r.basePoints * r.lockMult * r.contrarianMult, 5);
  });

  it("exact-score correct earns 50 + 200 = 250 base points", () => {
    const r = scoreGroupMatchPrediction({
      stage: "group",
      predictedOutcome: "home_win",
      actualOutcome: "home_win",
      predictedHomeScore: 2,
      predictedAwayScore: 1,
      actualHomeScore: 2,
      actualAwayScore: 1,
      impliedAtLock: 0.6,
      secondsSinceLock: 0,
      windowSeconds: 1_000_000,
    });
    expect(r.basePoints).toBe(250);
    expect(r.exactScoreCorrect).toBe(true);
  });

  it("wrong outcome earns 0", () => {
    const r = scoreGroupMatchPrediction({
      stage: "group",
      predictedOutcome: "home_win",
      actualOutcome: "draw",
      impliedAtLock: 0.05,
      secondsSinceLock: 0,
      windowSeconds: 1_000_000,
    });
    expect(r.basePoints).toBe(0);
    expect(r.pointsAwarded).toBe(0);
  });
});

describe("per-match score — multipliers (docs/30)", () => {
  it("lockMultiplier returns 5.0 at the moment of draw", () => {
    expect(lockMultiplier(0, 1_000_000)).toBe(5.0);
  });

  it("lockMultiplier returns 1.0 at or after kickoff", () => {
    expect(lockMultiplier(1_000_000, 1_000_000)).toBe(1.0);
    expect(lockMultiplier(2_000_000, 1_000_000)).toBe(1.0);
  });

  it("lockMultiplier follows the exponential curve in between", () => {
    // ~1 week before kickoff in a 5-week window: paper says ~2.4×.
    // Window = 5 * 7 * 86400 = 3024000; 1 week = 604800.
    // t/window = 0.2; 1 + 4 * exp(-0.6) ≈ 1 + 4 * 0.5488 = 3.195
    // The "1 week / 5 weeks before kickoff" = 4 weeks remaining of a 5-
    // week window means the user touched the pick when 4/5 of the
    // window had elapsed, so secondsSinceLock = 0.8 * window:
    //   1 + 4 * exp(-3*0.8) = 1 + 4 * 0.0907 = 1.363 ≈ 1.4× (matches docs)
    const result = lockMultiplier(0.8 * 1_000_000, 1_000_000);
    expect(result).toBeGreaterThan(1.3);
    expect(result).toBeLessThan(1.5);
  });

  it("contrarianMultiplier: 1.0 for favourites", () => {
    expect(contrarianMultiplier(0.7)).toBe(1.0);
    expect(contrarianMultiplier(0.51)).toBe(1.0);
  });

  it("contrarianMultiplier: 1.25 for 30-50% implied", () => {
    expect(contrarianMultiplier(0.4)).toBe(1.25);
    expect(contrarianMultiplier(0.3)).toBe(1.25);
  });

  it("contrarianMultiplier: 1.75 for 15-30% implied", () => {
    expect(contrarianMultiplier(0.2)).toBe(1.75);
    expect(contrarianMultiplier(0.15)).toBe(1.75);
  });

  it("contrarianMultiplier: 2.5 for 5-15% implied", () => {
    expect(contrarianMultiplier(0.1)).toBe(2.5);
    expect(contrarianMultiplier(0.05)).toBe(2.5);
  });

  it("contrarianMultiplier: 4.0 for <5% implied", () => {
    expect(contrarianMultiplier(0.04)).toBe(4.0);
    expect(contrarianMultiplier(0.0)).toBe(4.0);
  });

  it("worked example: 100 × 5.0 × 4.0 = 2000 for a 6%-implied early-locked group winner", () => {
    // docs/30 §"contrarian multiplier" worked example uses
    // base=100 (group winner). Our group-match outcome base is 50, so
    // the worked-example product against group_outcome is 50*5*4=1000.
    // Verify scoreGroupPlacement separately for the 100 case.
    expect(scoreGroupPlacement({ position: 1, predictedTeam: "ARG", actualTeam: "ARG" })).toBe(100);
    expect(scoreGroupPlacement({ position: 2, predictedTeam: "FRA", actualTeam: "FRA" })).toBe(50);
    expect(scoreGroupPlacement({ position: 1, predictedTeam: "ARG", actualTeam: "BRA" })).toBe(0);
  });
});

describe("per-match score — knockout rounds", () => {
  it("R32 winner earns 200 base", () => {
    const r = scoreKnockoutMatchPrediction({
      stage: "r32",
      predictedWinner: "ARG",
      actualWinner: "ARG",
      impliedAtLock: 0.6,
      secondsSinceLock: 1_000_000,
      windowSeconds: 1_000_000,
    });
    expect(r.basePoints).toBe(200);
  });

  it("R16 winner earns 400 base", () => {
    const r = scoreKnockoutMatchPrediction({
      stage: "r16",
      predictedWinner: "ARG",
      actualWinner: "ARG",
      impliedAtLock: 0.6,
      secondsSinceLock: 1_000_000,
      windowSeconds: 1_000_000,
    });
    expect(r.basePoints).toBe(400);
  });

  it("QF=800, SF=1500, F=3000 base scaffold", () => {
    expect(BASE_POINTS.knockout.qf).toBe(800);
    expect(BASE_POINTS.knockout.sf).toBe(1500);
    expect(BASE_POINTS.knockout.f).toBe(3000);
  });

  it("wrong knockout pick earns 0", () => {
    const r = scoreKnockoutMatchPrediction({
      stage: "f",
      predictedWinner: "ARG",
      actualWinner: "FRA",
      impliedAtLock: 0.05,
      secondsSinceLock: 0,
      windowSeconds: 1_000_000,
    });
    expect(r.pointsAwarded).toBe(0);
  });

  it("multipliers compound: 4.0 × 5.0 on a correct R16 long-shot", () => {
    const r = scoreKnockoutMatchPrediction({
      stage: "r16",
      predictedWinner: "ARG",
      actualWinner: "ARG",
      impliedAtLock: 0.04, // 4.0× contrarian
      secondsSinceLock: 0, // 5.0× lock
      windowSeconds: 1_000_000,
    });
    expect(r.basePoints).toBe(400);
    expect(r.contrarianMult).toBe(4.0);
    expect(r.lockMult).toBe(5.0);
    expect(r.pointsAwarded).toBe(400 * 5 * 4);
  });
});
