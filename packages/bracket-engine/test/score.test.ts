/**
 * Score model tests. Long-shot rewards, time multiplier curve, stage
 * weighting, lock-and-hold bonus, determinism, full-bracket scoring.
 */

import { describe, expect, it } from "vitest";

import {
  BRACKET_MODE_MULTIPLIER,
  LOCK_AND_HOLD_BONUS,
  STAGE_MULTIPLIERS,
  confidenceMultiplier,
  scoreBracket,
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
    const base = fullPrediction();
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const groupB = tournament.groups.find((g) => g.id === "B")!;
    const pred: BracketPrediction = {
      ...base,
      knockouts: [{ match_id: "r32_01", winner: groupA.team_ids[0] }],
    };
    const completed = {
      groups: [],
      knockouts: [{ match_id: "r32_01", winner: groupA.team_ids[0], settled: true }],
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
    void groupB; // intentional: include vars in scope without warnings
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
