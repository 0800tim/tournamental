import { describe, expect, it } from "vitest";
import type { EventMessage, MatchInit, StateFrame } from "@vtorn/spec";
import { SPEC_VERSION } from "@vtorn/spec";
import {
  computeMatchStats,
  computeStatsAtTime,
  EMPTY_MATCH_STATS,
  formatMatchMinute,
  formatPossession,
} from "@/lib/match-stats";

const homeTeam = {
  id: "ARG",
  name: "Argentina",
  short_name: "ARG",
  kit: { primary: "#75AADB", secondary: "#FFFFFF" },
  players: [
    { id: "ARG_10", name: "Messi", number: 10, position: "ST" },
    { id: "ARG_9", name: "Di María", number: 11, position: "RW" },
    { id: "ARG_8", name: "De Paul", number: 7, position: "CM" },
    { id: "ARG_7", name: "Romero", number: 13, position: "CB" },
  ],
};

const awayTeam = {
  id: "FRA",
  name: "France",
  short_name: "FRA",
  kit: { primary: "#0055A4", secondary: "#FFFFFF" },
  players: [
    { id: "FRA_10", name: "Mbappé", number: 10, position: "ST" },
    { id: "FRA_9", name: "Giroud", number: 9, position: "ST" },
    { id: "FRA_1", name: "Lloris", number: 1, position: "GK" },
  ],
};

const init: MatchInit = {
  type: "match.init",
  spec_version: SPEC_VERSION,
  match_id: "test",
  sport: "soccer",
  field: { length: 100, width: 64, units: "m" },
  teams: [homeTeam, awayTeam],
  start_time: "2022-12-18T15:00:00Z",
  producer: "test",
};

const events: EventMessage[] = [
  // 23' Messi (home)
  { type: "event.shot", t: 1_379_500, player: "ARG_10", target: [50, 0, 1.5], on_target: true },
  { type: "event.goal", t: 1_380_000, player: "ARG_10", team: "ARG" },
  { type: "event.score_change", t: 1_380_001, home: 1, away: 0 },
  // 36' Di María (home, with assist)
  { type: "event.shot", t: 2_159_500, player: "ARG_9", target: [50, 0, 1.5], on_target: true },
  { type: "event.goal", t: 2_160_000, player: "ARG_9", team: "ARG", assist: "ARG_10" },
  { type: "event.score_change", t: 2_160_001, home: 2, away: 0 },
  // 80' Mbappé (away, penalty)
  { type: "event.shot", t: 4_799_500, player: "FRA_10", target: [-50, 0, 1.5], on_target: true },
  { type: "event.goal", t: 4_800_000, player: "FRA_10", team: "FRA" },
  { type: "event.score_change", t: 4_800_001, home: 2, away: 1 },
  // 81' Mbappé (away)
  { type: "event.shot", t: 4_859_500, player: "FRA_10", target: [-50, 0, 1.5], on_target: true },
  { type: "event.goal", t: 4_860_000, player: "FRA_10", team: "FRA" },
  { type: "event.score_change", t: 4_860_001, home: 2, away: 2 },
  // Mid-match events for stats coverage
  { type: "event.shot", t: 600_000, player: "ARG_8", target: [40, 5, 1.0], on_target: false },
  { type: "event.shot", t: 720_000, player: "FRA_9", target: [-40, 5, 1.0], on_target: true },
  { type: "event.save", t: 720_500, keeper: "ARG_7" },
  { type: "event.foul", t: 1_500_000, player: "FRA_9", victim: "ARG_10", severity: "yellow" },
  { type: "event.foul", t: 2_400_000, player: "ARG_8", victim: "FRA_10", severity: "soft" },
  { type: "event.foul", t: 3_000_000, player: "ARG_8", victim: "FRA_9", severity: "red" },
  { type: "event.pass", t: 100_000, from: "ARG_10", to: "ARG_9", target: [10, 5], success: true },
  { type: "event.pass", t: 110_000, from: "ARG_9", to: "ARG_10", target: [-5, 0], success: false },
  { type: "event.out_of_bounds", t: 200_000, touched_by: "FRA_1", restart: "corner" },
  { type: "event.substitution", t: 3_900_000, team: "FRA", player_in: "FRA_9", player_out: "FRA_1" },
];

describe("computeMatchStats", () => {
  it("returns EMPTY_MATCH_STATS when init is null", () => {
    expect(computeMatchStats(null, events, { t: 9_000_000 })).toEqual(EMPTY_MATCH_STATS);
  });

  it("returns 0-0 with no scorers at t=0", () => {
    const stats = computeMatchStats(init, events, { t: 0 });
    expect(stats.home.goals).toBe(0);
    expect(stats.away.goals).toBe(0);
    expect(stats.scorers).toEqual([]);
    expect(stats.lastGoalT).toBe(-1);
    expect(stats.mostRecentGoal).toBeNull();
  });

  it("returns 1-0 after Messi's goal at 23'", () => {
    const stats = computeMatchStats(init, events, { t: 1_400_000 });
    expect(stats.home.goals).toBe(1);
    expect(stats.away.goals).toBe(0);
    expect(stats.scorers).toHaveLength(1);
    expect(stats.scorers[0]?.playerName).toBe("Messi");
    expect(stats.scorers[0]?.matchSec).toBe(1380);
    expect(stats.scorers[0]?.scoreAfter).toEqual({ home: 1, away: 0 });
    expect(stats.mostRecentGoal?.playerId).toBe("ARG_10");
    expect(stats.lastGoalT).toBe(1_380_000);
  });

  it("returns 2-0 after Di María's 36' goal with the assist credited", () => {
    const stats = computeMatchStats(init, events, { t: 2_200_000 });
    expect(stats.home.goals).toBe(2);
    expect(stats.away.goals).toBe(0);
    expect(stats.scorers).toHaveLength(2);
    expect(stats.scorers[1]?.playerName).toBe("Di María");
    expect(stats.scorers[1]?.assistName).toBe("Messi");
    expect(stats.scorers[1]?.scoreAfter).toEqual({ home: 2, away: 0 });
  });

  it("returns 2-2 after both Mbappé goals", () => {
    const stats = computeMatchStats(init, events, { t: 4_900_000 });
    expect(stats.home.goals).toBe(2);
    expect(stats.away.goals).toBe(2);
    expect(stats.scorers).toHaveLength(4);
    expect(stats.scorers[2]?.playerName).toBe("Mbappé");
    expect(stats.scorers[3]?.playerName).toBe("Mbappé");
    expect(stats.mostRecentGoal?.scoreAfter).toEqual({ home: 2, away: 2 });
  });

  it("scorer side matches the team that scored (home/away)", () => {
    const stats = computeMatchStats(init, events, { t: 4_900_000 });
    expect(stats.scorers.map((s) => s.side)).toEqual(["home", "home", "away", "away"]);
  });

  it("scorer ticker is in chronological order", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    for (let i = 1; i < stats.scorers.length; i += 1) {
      expect(stats.scorers[i].matchSec).toBeGreaterThanOrEqual(stats.scorers[i - 1].matchSec);
    }
  });

  it("counts shots and shots-on-target per side correctly", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    // ARG (home): Messi 23' (on-target) + Di María 36' (on-target) + ARG_8 600s (off-target) = 3 shots, 2 on-target
    expect(stats.home.shots).toBe(3);
    expect(stats.home.shotsOnTarget).toBe(2);
    // FRA (away): Mbappé 80' (on-target) + Mbappé 81' (on-target) + Giroud 720s (on-target) = 3 shots, 3 on-target
    expect(stats.away.shots).toBe(3);
    expect(stats.away.shotsOnTarget).toBe(3);
  });

  it("counts saves per side", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    expect(stats.home.saves).toBe(1); // ARG_7 made a save
    expect(stats.away.saves).toBe(0);
  });

  it("counts fouls and cards (yellow + red) per side", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    expect(stats.home.fouls).toBe(2);
    expect(stats.home.yellows).toBe(0);
    expect(stats.home.reds).toBe(1);
    expect(stats.away.fouls).toBe(1);
    expect(stats.away.yellows).toBe(1);
    expect(stats.away.reds).toBe(0);
    expect(stats.cards).toHaveLength(2);
    expect(stats.cards.map((c) => c.severity)).toEqual(["yellow", "red"]);
  });

  it("counts passes and completions", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    expect(stats.home.passes).toBe(2);
    expect(stats.home.passesCompleted).toBe(1);
  });

  it("attributes corners to the OTHER side from touched_by", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    // FRA_1 (away keeper) touched it last → home gets the corner
    expect(stats.home.corners).toBe(1);
    expect(stats.away.corners).toBe(0);
  });

  it("collects substitutions in order with names resolved", () => {
    const stats = computeMatchStats(init, events, { t: 9_000_000 });
    expect(stats.subs).toHaveLength(1);
    expect(stats.subs[0]?.playerInName).toBe("Giroud");
    expect(stats.subs[0]?.playerOutName).toBe("Lloris");
    expect(stats.subs[0]?.side).toBe("away");
  });

  it("is idempotent at any t (calling twice returns equal result)", () => {
    const a = computeMatchStats(init, events, { t: 4_500_000 });
    const b = computeMatchStats(init, events, { t: 4_500_000 });
    expect(a).toEqual(b);
  });

  it("monotonic counts as t increases", () => {
    const tValues = [0, 500_000, 1_500_000, 2_500_000, 3_500_000, 5_000_000, 9_000_000];
    let prevHomeShots = 0;
    let prevAwayShots = 0;
    let prevHomeFouls = 0;
    for (const t of tValues) {
      const s = computeMatchStats(init, events, { t });
      expect(s.home.shots).toBeGreaterThanOrEqual(prevHomeShots);
      expect(s.away.shots).toBeGreaterThanOrEqual(prevAwayShots);
      expect(s.home.fouls).toBeGreaterThanOrEqual(prevHomeFouls);
      prevHomeShots = s.home.shots;
      prevAwayShots = s.away.shots;
      prevHomeFouls = s.home.fouls;
    }
  });

  it("monotonic goals as t increases", () => {
    const tValues = [0, 1_000_000, 1_400_000, 2_200_000, 4_810_000, 4_900_000, 9_000_000];
    const goals = tValues.map((t) =>
      computeMatchStats(init, events, { t }).home.goals +
      computeMatchStats(init, events, { t }).away.goals,
    );
    for (let i = 1; i < goals.length; i += 1) {
      expect(goals[i]).toBeGreaterThanOrEqual(goals[i - 1]);
    }
  });

  it("ignores events strictly after t", () => {
    const stats = computeMatchStats(init, events, { t: 1_379_999 });
    expect(stats.home.goals).toBe(0);
    expect(stats.scorers).toHaveLength(0);
  });

  it("includes events at exactly t (inclusive)", () => {
    const stats = computeMatchStats(init, events, { t: 1_380_000 });
    expect(stats.home.goals).toBe(1);
    expect(stats.scorers).toHaveLength(1);
  });

  it("works with shuffled (unsorted) event input", () => {
    const shuffled = [...events].reverse();
    const stats = computeMatchStats(init, shuffled, { t: 9_000_000 });
    expect(stats.home.goals).toBe(2);
    expect(stats.away.goals).toBe(2);
    expect(stats.scorers.map((s) => s.matchSec)).toEqual([1380, 2160, 4800, 4860]);
  });

  it("does not count penalty-shootout goals as regulation goals", () => {
    const withShootout: EventMessage[] = [
      ...events,
      { type: "event.penalty_shootout_start", t: 7_260_000 },
      { type: "event.penalty_attempt", t: 7_290_000, player: "FRA_10", team: "FRA", outcome: "scored" },
      { type: "event.goal", t: 7_290_001, player: "FRA_10", team: "FRA" },
      { type: "event.penalty_shootout_end", t: 7_500_000, winner: "ARG", score: { home: 4, away: 2 } },
    ];
    const stats = computeMatchStats(init, withShootout, { t: 7_999_999 });
    // Regulation goals should still be 2-2
    expect(stats.home.goals).toBe(2);
    expect(stats.away.goals).toBe(2);
    expect(stats.scorers).toHaveLength(4);
  });

  it("computes possession from the state-frame ball carrier", () => {
    // Each frame's carrier applies for the segment until the next frame.
    // We don't include the trailing segment past the last frame.
    const frames: StateFrame[] = [
      makeFrame(0, "ARG_10"),       // 0..10s ARG
      makeFrame(10_000, "ARG_10"),  // 10..20s ARG
      makeFrame(20_000, "ARG_10"),  // 20..30s ARG
      makeFrame(30_000, "FRA_10"),  // 30..40s FRA
      makeFrame(40_000, "FRA_10"),
    ];
    const stats = computeMatchStats(init, [], { t: 40_000, frames });
    // Home carried for 30s, away for 10s, of 40s total → 0.75 / 0.25
    expect(stats.home.possession).toBeCloseTo(0.75, 2);
    expect(stats.away.possession).toBeCloseTo(0.25, 2);
  });

  it("possession sums to ~1 when frames cover the playhead", () => {
    const frames: StateFrame[] = [
      makeFrame(0, "ARG_10"),
      makeFrame(5_000, "FRA_10"),
      makeFrame(10_000, "ARG_10"),
    ];
    const stats = computeMatchStats(init, [], { t: 10_000, frames });
    expect(stats.home.possession + stats.away.possession).toBeCloseTo(1, 2);
  });

  it("possession is 0/0 when no frames have a carrier", () => {
    const frames: StateFrame[] = [
      makeFrame(0, undefined),
      makeFrame(10_000, undefined),
    ];
    const stats = computeMatchStats(init, [], { t: 10_000, frames });
    expect(stats.home.possession).toBe(0);
    expect(stats.away.possession).toBe(0);
  });

  it("aligns home.goals with event.score_change if score_change leads goals", () => {
    const onlyScoreChanges: EventMessage[] = [
      { type: "event.score_change", t: 1_000, home: 3, away: 2 },
    ];
    const stats = computeMatchStats(init, onlyScoreChanges, { t: 5_000 });
    expect(stats.home.goals).toBe(3);
    expect(stats.away.goals).toBe(2);
  });
});

describe("computeStatsAtTime alias", () => {
  it("delegates to computeMatchStats with no frames", () => {
    const a = computeStatsAtTime(init, events, 4_900_000);
    const b = computeMatchStats(init, events, { t: 4_900_000 });
    expect(a).toEqual(b);
  });
});

describe("formatters", () => {
  it("formatMatchMinute renders MM' from seconds", () => {
    expect(formatMatchMinute(0)).toBe("0'");
    expect(formatMatchMinute(60)).toBe("1'");
    expect(formatMatchMinute(1380)).toBe("23'");
    expect(formatMatchMinute(3600)).toBe("60'");
  });

  it("formatPossession clamps and rounds to 0..100", () => {
    expect(formatPossession(0)).toBe("0");
    expect(formatPossession(0.5)).toBe("50");
    expect(formatPossession(0.6)).toBe("60");
    expect(formatPossession(1)).toBe("100");
    expect(formatPossession(-0.1)).toBe("0");
    expect(formatPossession(2)).toBe("100");
  });
});

function makeFrame(t: number, carrier?: string): StateFrame {
  return {
    type: "state",
    t,
    ball: { pos: [0, 0, 0], carrier },
    players: [],
  };
}
