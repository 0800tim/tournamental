/**
 * Rugby union pool tables. Covers:
 *
 *   - 4-2-0 points with the try bonus and the losing bonus.
 *   - Bonuses only apply when tries / scores are entered.
 *   - The World Rugby tiebreak chain: winner of the match between two
 *     tied teams, points difference, tries difference, points for,
 *     tries for, world ranking, then the user's pick.
 *   - Rule selection (explicit rules, sport preset, football default).
 *   - Cross-group comparison for the best third-placed teams.
 */

import { describe, expect, it } from "vitest";

import {
  FOOTBALL_STANDINGS_RULES,
  RUGBY_UNION_STANDINGS_RULES,
  compareStandingsAcrossGroups,
  computeGroupStandings,
  detectTiesNeedingTiebreaker,
  standingsRulesFor,
  type GroupStanding,
} from "../src/standings.js";
import type { GroupTiebreaker, MatchPrediction, Team, Tournament } from "../src/tournament.js";

const teams: Team[] = [
  { id: "NZL", name: "New Zealand", country: "NZL", fifa_rank: 99, world_rank: 1, pre_tournament_implied_win: 0.3 },
  { id: "ARG", name: "Argentina", country: "ARG", fifa_rank: 99, world_rank: 6, pre_tournament_implied_win: 0.05 },
  { id: "ITA", name: "Italy", country: "ITA", fifa_rank: 10, pre_tournament_implied_win: 0.01 },
  { id: "TGA", name: "Tonga", country: "TGA", fifa_rank: 99, world_rank: 15, pre_tournament_implied_win: 0.001 },
];

/** Pool A, every pair once: 1 NZL-ARG, 2 ITA-TGA, 3 NZL-ITA, 4 ARG-TGA, 5 NZL-TGA, 6 ARG-ITA. */
const pool: Tournament = {
  id: "rwc-test",
  name: "Rugby pool fixture",
  sport: "rugby_union",
  start_utc: "2027-10-01T00:00:00Z",
  final_utc: "2027-11-13T00:00:00Z",
  teams,
  groups: [{ id: "A", team_ids: ["NZL", "ARG", "ITA", "TGA"] }],
  group_fixtures: [
    [1, 0, 1],
    [2, 2, 3],
    [3, 0, 2],
    [4, 1, 3],
    [5, 0, 3],
    [6, 1, 2],
  ].map(([match_no, home_idx, away_idx]) => ({
    match_no: match_no!,
    group_id: "A",
    home_idx: home_idx!,
    away_idx: away_idx!,
    kickoff_utc: "2027-10-01T00:00:00Z",
    host: "US" as const,
    venue: "Test",
  })),
  knockouts: [],
  advancement: { automatic_per_group: 2, wildcard_third: 4, wildcard_fourth: 0 },
};

function pred(
  matchNo: number,
  outcome: MatchPrediction["outcome"],
  scores?: [number, number],
  tries?: [number, number],
): [string, MatchPrediction] {
  return [
    String(matchNo),
    {
      matchId: String(matchNo),
      outcome,
      homeScore: scores?.[0],
      awayScore: scores?.[1],
      homeTries: tries?.[0],
      awayTries: tries?.[1],
      lockedAt: "2027-09-01T00:00:00Z",
    },
  ];
}

function row(s: readonly GroupStanding[], code: string): GroupStanding {
  const r = s.find((x) => x.teamCode === code);
  if (!r) throw new Error(`No standing for ${code}`);
  return r;
}

function order(s: readonly GroupStanding[]): string[] {
  return s.map((x) => x.teamCode);
}

describe("rugby standings: points and bonuses", () => {
  it("pays 4 for a win, 2 for a draw, 0 for a loss", () => {
    const s = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "home_win"), pred(2, "draw")]));
    expect(row(s, "NZL").points).toBe(4);
    expect(row(s, "ARG").points).toBe(0);
    expect(row(s, "ITA").points).toBe(2);
    expect(row(s, "TGA").points).toBe(2);
  });

  it("gives a try bonus to any side scoring four or more tries", () => {
    const s = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "home_win", [38, 31], [5, 4])]));
    expect(row(s, "NZL").points).toBe(5);
    expect(row(s, "NZL").bonusPoints).toBe(1);
    expect(row(s, "ARG").bonusPoints).toBe(2); // four tries and lost by seven
    expect(row(s, "ARG").points).toBe(2);
    expect(row(s, "NZL").triesFor).toBe(5);
    expect(row(s, "ARG").triesAgainst).toBe(5);
    expect(row(s, "ARG").tryDiff).toBe(-1);
  });

  it("gives no try bonus for three tries", () => {
    const s = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "home_win", [24, 3], [3, 0])]));
    expect(row(s, "NZL").bonusPoints).toBe(0);
  });

  it("gives the losing bonus at a margin of seven and not at eight", () => {
    const seven = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "away_win", [20, 27])]));
    expect(row(seven, "NZL").points).toBe(1);
    const eight = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "away_win", [20, 28])]));
    expect(row(eight, "NZL").points).toBe(0);
  });

  it("gives no losing bonus on a draw and none when scores are blank", () => {
    const draw = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "draw", [20, 20])]));
    expect(row(draw, "NZL").bonusPoints).toBe(0);
    const blank = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "home_win", undefined, [4, 1])]));
    expect(row(blank, "ARG").bonusPoints).toBe(0);
    expect(row(blank, "NZL").bonusPoints).toBe(1); // tries entered, scores not
  });

  it("applies no tries and no bonuses to football", () => {
    const football: Tournament = { ...pool, sport: "football" };
    const s = computeGroupStandings("A", football, Object.fromEntries([pred(1, "home_win", [3, 2], [4, 4])]));
    expect(row(s, "NZL").points).toBe(3);
    expect(row(s, "NZL").bonusPoints).toBe(0);
    expect(row(s, "ARG").bonusPoints).toBe(0);
    expect(row(s, "NZL").triesFor).toBe(4); // counted, never scored
  });
});

describe("rugby standings: the tiebreak chain", () => {
  /** NZL and ARG both beat ITA and TGA; everything hinges on match 1 and the margins. */
  function twoWay(match1: [string, MatchPrediction], extra: [string, MatchPrediction][] = []) {
    return Object.fromEntries([
      match1,
      pred(2, "home_win", [20, 10]),
      pred(3, "home_win", [30, 10]),
      pred(4, "home_win", [30, 10]),
      pred(5, "home_win", [30, 10]),
      pred(6, "home_win", [30, 10]),
      ...extra,
    ]);
  }

  it("the winner of the match between two tied teams ranks higher, whatever the points difference", () => {
    // ARG beats NZL by eight (no bonus) and draws with TGA: 4 + 2 + 4 = 10.
    // NZL thrashes ITA and TGA with try bonuses: 5 + 5 = 10, far better
    // difference. Level on 10, ARG finishes above on head-to-head.
    const level = computeGroupStandings("A", pool, {
      ...twoWay(pred(1, "away_win", [20, 28])),
      "3": pred(3, "home_win", [60, 0], [9, 0])[1],
      "5": pred(5, "home_win", [60, 0], [9, 0])[1],
      "4": pred(4, "draw", [15, 15])[1],
    });
    expect(row(level, "NZL").points).toBe(10);
    expect(row(level, "ARG").points).toBe(10);
    expect(row(level, "NZL").goalDiff).toBeGreaterThan(row(level, "ARG").goalDiff);
    expect(order(level).slice(0, 2)).toEqual(["ARG", "NZL"]);
    // Lose by seven instead and NZL's bonus point puts it clear on 11.
    const clear = computeGroupStandings("A", pool, {
      ...twoWay(pred(1, "away_win", [20, 27])),
      "3": pred(3, "home_win", [60, 0], [9, 0])[1],
      "5": pred(5, "home_win", [60, 0], [9, 0])[1],
      "4": pred(4, "draw", [15, 15])[1],
    });
    expect(row(clear, "NZL").points).toBe(11);
    expect(order(clear).slice(0, 2)).toEqual(["NZL", "ARG"]);
  });

  it("a drawn head-to-head decides nothing, so points difference applies", () => {
    const s = computeGroupStandings("A", pool, {
      ...twoWay(pred(1, "draw", [20, 20])),
      "3": pred(3, "home_win", [60, 0])[1],
    });
    expect(order(s).slice(0, 2)).toEqual(["NZL", "ARG"]);
  });

  it("with three teams level the head-to-head winner is skipped and difference decides", () => {
    // Circle: NZL beats ARG, ARG beats ITA, ITA beats NZL; all beat TGA.
    // Differences: ARG +30, NZL +20, ITA +20. ARG is clear on difference;
    // NZL and ITA then restart the chain and ITA won the match between them.
    const s = computeGroupStandings(
      "A",
      pool,
      Object.fromEntries([
        pred(1, "home_win", [20, 10]), // NZL > ARG
        pred(6, "home_win", [20, 10]), // ARG > ITA
        pred(3, "away_win", [10, 30]), // ITA > NZL
        pred(5, "home_win", [30, 0]),
        pred(4, "home_win", [30, 0]),
        pred(2, "home_win", [10, 0]),
      ]),
    );
    expect(s.map((r) => r.goalDiff)).toEqual([30, 20, 20, -70]);
    expect(order(s)).toEqual(["ARG", "ITA", "NZL", "TGA"]);
  });

  it("places the highest ranked team, then restarts the chain for the rest", () => {
    // NZL, ARG and ITA each beat TGA and form a circle. ITA is clear on
    // difference (+50 to +30), so it is placed first; NZL and ARG then
    // restart from the first criterion and NZL won the match between
    // them, which outranks ARG's better tries difference.
    const s = computeGroupStandings(
      "A",
      pool,
      Object.fromEntries([
        pred(1, "home_win", [20, 10], [1, 2]), // NZL > ARG
        pred(6, "home_win", [30, 10]), // ARG > ITA
        pred(3, "away_win", [10, 50]), // ITA > NZL
        pred(5, "home_win", [60, 0]), // NZL > TGA
        pred(4, "home_win", [30, 10]), // ARG > TGA
        pred(2, "home_win", [40, 10]), // ITA > TGA
      ]),
    );
    expect(s.map((r) => r.points)).toEqual([8, 8, 8, 0]);
    expect(row(s, "NZL").goalDiff).toBe(30);
    expect(row(s, "ARG").goalDiff).toBe(30);
    expect(row(s, "ARG").tryDiff).toBeGreaterThan(row(s, "NZL").tryDiff);
    expect(order(s)).toEqual(["ITA", "NZL", "ARG", "TGA"]);
  });

  it("keeps applying criteria until one team is clear at the top before any restart", () => {
    // NZL and ARG level on +30, ITA on +20: nobody is placed yet. Tries
    // difference then makes ARG the highest. The process restarts for
    // NZL and ITA, and ITA won their match, so ITA finishes above NZL
    // despite the worse difference.
    const s = computeGroupStandings(
      "A",
      pool,
      Object.fromEntries([
        pred(1, "home_win", [20, 10], [1, 2]), // NZL > ARG
        pred(6, "home_win", [30, 10]), // ARG > ITA
        pred(3, "away_win", [10, 20]), // ITA > NZL
        pred(5, "home_win", [30, 0]), // NZL > TGA
        pred(4, "home_win", [30, 10]), // ARG > TGA
        pred(2, "home_win", [40, 10]), // ITA > TGA
      ]),
    );
    expect(s.map((r) => r.points)).toEqual([8, 8, 8, 0]);
    expect([row(s, "NZL").goalDiff, row(s, "ARG").goalDiff, row(s, "ITA").goalDiff]).toEqual([30, 30, 20]);
    expect(order(s)).toEqual(["ARG", "ITA", "NZL", "TGA"]);
  });

  it("pays no losing bonus when the scores contradict the outcome", () => {
    const s = computeGroupStandings("A", pool, Object.fromEntries([pred(1, "home_win", [20, 20]), pred(2, "away_win", [30, 10])]));
    expect(row(s, "ARG").bonusPoints).toBe(0); // "home win" with level scores
    expect(row(s, "ITA").bonusPoints).toBe(0); // "away win" while ahead on the scores
    expect(row(s, "NZL").points).toBe(4);
    expect(row(s, "TGA").points).toBe(4);
  });

  it("tries difference, then points for, then tries for break a level difference", () => {
    // ITA and TGA lose everything; sort the bottom two.
    const base = Object.fromEntries([
      pred(1, "home_win", [20, 10]),
      pred(3, "home_win", [30, 10]), // NZL 30 ITA 10
      pred(4, "home_win", [30, 10]), // ARG 30 TGA 10
      pred(5, "home_win", [30, 10]), // NZL 30 TGA 10
      pred(6, "home_win", [30, 10]), // ARG 30 ITA 10
    ]);
    // Match 2 drawn 15-15: ITA and TGA level on points, difference and points for.
    const byTries = computeGroupStandings("A", pool, {
      ...base,
      "2": pred(2, "draw", [15, 15], [2, 1])[1],
    });
    expect(order(byTries).slice(2)).toEqual(["ITA", "TGA"]);
    const byTriesReversed = computeGroupStandings("A", pool, {
      ...base,
      "2": pred(2, "draw", [15, 15], [1, 2])[1],
    });
    expect(order(byTriesReversed).slice(2)).toEqual(["TGA", "ITA"]);
    // Equal tries in match 2 and equal difference, but TGA scored more.
    const byPointsFor = computeGroupStandings("A", pool, {
      ...base,
      "5": pred(5, "home_win", [40, 20])[1],
      "2": pred(2, "draw", [15, 15], [2, 2])[1],
    });
    expect(row(byPointsFor, "TGA").goalDiff).toBe(row(byPointsFor, "ITA").goalDiff);
    expect(row(byPointsFor, "TGA").goalsFor).toBe(45);
    expect(row(byPointsFor, "ITA").goalsFor).toBe(35);
    expect(order(byPointsFor).slice(2)).toEqual(["TGA", "ITA"]);
    // Equal difference, points for and tries difference; TGA scored more tries.
    const byTriesFor = computeGroupStandings("A", pool, {
      ...base,
      "3": pred(3, "home_win", [40, 20], [4, 4])[1],
      "5": pred(5, "home_win", [40, 20], [5, 5])[1],
      "2": pred(2, "draw", [15, 15], [2, 2])[1],
    });
    expect(row(byTriesFor, "TGA").goalsFor).toBe(row(byTriesFor, "ITA").goalsFor);
    expect(row(byTriesFor, "TGA").tryDiff).toBe(0);
    expect(row(byTriesFor, "TGA").triesFor).toBe(7);
    expect(row(byTriesFor, "ITA").triesFor).toBe(6);
    expect(order(byTriesFor).slice(2)).toEqual(["TGA", "ITA"]);
  });

  it("world ranking is the last criterion and falls back to fifa_rank", () => {
    // ITA (no world_rank, fifa_rank 10) v TGA (world_rank 15): same everything.
    const predictions = Object.fromEntries([pred(2, "draw", [15, 15], [2, 2])]);
    const s = computeGroupStandings("A", pool, predictions);
    expect(order(s).slice(0, 2)).toEqual(["ITA", "TGA"]);
    expect(detectTiesNeedingTiebreaker(s, { tournament: pool, groupId: "A", predictions })).toEqual([]);
  });

  it("falls through to the user's pick when the chain cannot separate teams", () => {
    const noRanks: Tournament = { ...pool, teams: teams.map((t) => ({ ...t, fifa_rank: 50, world_rank: undefined })) };
    const predictions = Object.fromEntries([pred(2, "draw", [15, 15], [2, 2])]);
    const s = computeGroupStandings("A", noRanks, predictions);
    expect(order(s).slice(0, 2)).toEqual(["ITA", "TGA"]); // alphabetical fallback
    const ties = detectTiesNeedingTiebreaker(s, { tournament: noRanks, groupId: "A", predictions });
    expect(ties).toEqual([
      { positions: [1, 2], teamCodes: ["ITA", "TGA"] },
      { positions: [3, 4], teamCodes: ["ARG", "NZL"] },
    ]);
    const tiebreaker: GroupTiebreaker = {
      groupId: "A",
      rankedTeams: ["TGA", "ITA", "NZL", "ARG"],
      setAt: "2027-09-01T00:00:00Z",
    };
    const picked = computeGroupStandings("A", noRanks, predictions, tiebreaker);
    expect(order(picked)).toEqual(["TGA", "ITA", "NZL", "ARG"]);
    expect(detectTiesNeedingTiebreaker(picked, { tournament: noRanks, groupId: "A", predictions, tiebreaker })).toEqual([]);
  });
});

describe("rugby standings: teams the chain cannot separate", () => {
  it("orders identical teams by the user's pick together and reports one tie group", () => {
    const noRanks: Tournament = { ...pool, teams: teams.map((t) => ({ ...t, fifa_rank: 50, world_rank: undefined })) };
    const predictions = Object.fromEntries([
      pred(1, "draw", [10, 10], [1, 1]),
      pred(3, "draw", [10, 10], [1, 1]),
      pred(6, "draw", [10, 10], [1, 1]),
      pred(5, "home_win", [30, 0]),
      pred(4, "home_win", [30, 0]),
      pred(2, "home_win", [30, 0]),
    ]);
    const s = computeGroupStandings("A", noRanks, predictions);
    expect(s.map((r) => r.points)).toEqual([8, 8, 8, 0]);
    expect(order(s)).toEqual(["ARG", "ITA", "NZL", "TGA"]); // alphabetical fallback
    expect(detectTiesNeedingTiebreaker(s, { tournament: noRanks, groupId: "A", predictions })).toEqual([
      { positions: [1, 2, 3], teamCodes: ["ARG", "ITA", "NZL"] },
    ]);
    const tiebreaker: GroupTiebreaker = { groupId: "A", rankedTeams: ["NZL", "ITA", "ARG", "TGA"], setAt: "2027-09-01T00:00:00Z" };
    expect(order(computeGroupStandings("A", noRanks, predictions, tiebreaker))).toEqual(["NZL", "ITA", "ARG", "TGA"]);
  });
});

describe("rule selection", () => {
  it("defaults to football and picks the rugby union preset by sport", () => {
    expect(standingsRulesFor({})).toBe(FOOTBALL_STANDINGS_RULES);
    expect(standingsRulesFor({ sport: "football" })).toBe(FOOTBALL_STANDINGS_RULES);
    expect(standingsRulesFor({ sport: "rugby_union" })).toBe(RUGBY_UNION_STANDINGS_RULES);
  });

  it("explicit standings_rules win over the sport preset", () => {
    const custom = { points: { win: 2, draw: 1, loss: 0 }, tiebreak: ["score_diff" as const] };
    expect(standingsRulesFor({ sport: "rugby_union", standings_rules: custom })).toBe(custom);
    const s = computeGroupStandings("A", { ...pool, standings_rules: custom }, Object.fromEntries([pred(1, "home_win", [10, 3], [4, 0])]));
    expect(row(s, "NZL").points).toBe(2);
    expect(row(s, "ARG").points).toBe(0); // no losing bonus in the custom rule
  });

  it("refuses a rugby league tournament without explicit rules", () => {
    expect(() => standingsRulesFor({ sport: "rugby_league" })).toThrow(/standings_rules/);
  });
});

describe("compareStandingsAcrossGroups", () => {
  const base: Omit<GroupStanding, "teamCode"> = {
    played: 3, wins: 1, draws: 1, losses: 1,
    goalsFor: 50, goalsAgainst: 50, goalDiff: 0,
    triesFor: 6, triesAgainst: 6, tryDiff: 0,
    bonusPoints: 0, points: 6,
  };

  it("ranks thirds by points, then difference, points for, tries for, ranking; never tries difference or head-to-head", () => {
    const cmp = compareStandingsAcrossGroups(RUGBY_UNION_STANDINGS_RULES, teams);
    const rows: GroupStanding[] = [
      { ...base, teamCode: "TGA", tryDiff: 3 }, // world_rank 15; tries difference does not count for thirds
      { ...base, teamCode: "ARG" }, // world_rank 6
      { ...base, teamCode: "ITA", triesFor: 7, triesAgainst: 7 },
      { ...base, teamCode: "NZL", goalDiff: 5 },
    ];
    expect(rows.sort(cmp).map((r) => r.teamCode)).toEqual(["NZL", "ITA", "ARG", "TGA"]);
  });

  it("keeps football's points, goal difference, goals for order", () => {
    const cmp = compareStandingsAcrossGroups(FOOTBALL_STANDINGS_RULES);
    const rows: GroupStanding[] = [
      { ...base, teamCode: "B", goalsFor: 51 },
      { ...base, teamCode: "A", goalsFor: 52 },
      { ...base, teamCode: "C", goalDiff: 1 },
    ];
    expect(rows.sort(cmp).map((r) => r.teamCode)).toEqual(["C", "A", "B"]);
  });
});
