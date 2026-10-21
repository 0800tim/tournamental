/**
 * Best thirds sized and ordered by the tournament's rules (lib/bracket/thirds).
 */
import { describe, expect, it } from "vitest";
import {
  loadFixtures2026,
  loadFixturesRwc2027,
  type GroupStanding,
  type Tournament,
} from "@tournamental/bracket-engine";

import {
  bestThirdsTarget,
  rankThirds,
  rankingLabel,
  selectBestThirds,
  teamWorldRank,
  thirdsEntryStageLabel,
  thirdsTiebreakLabels,
  type ThirdCandidate,
} from "@/lib/bracket/thirds";

const wc: Tournament = loadFixtures2026();
const rwc: Tournament = loadFixturesRwc2027();

function standing(
  teamCode: string,
  o: { points: number; diff?: number; scored?: number; tries?: number },
): GroupStanding {
  const scored = o.scored ?? 0;
  const diff = o.diff ?? 0;
  const tries = o.tries ?? 0;
  return {
    teamCode,
    played: 3,
    wins: 1,
    draws: 0,
    losses: 2,
    goalsFor: scored,
    goalsAgainst: scored - diff,
    goalDiff: diff,
    triesFor: tries,
    triesAgainst: 0,
    tryDiff: tries,
    bonusPoints: 0,
    points: o.points,
  };
}

function third(groupId: string, s: GroupStanding): ThirdCandidate {
  return { groupId, standing: s };
}

describe("bestThirdsTarget", () => {
  it("reads the count from the tournament's advancement rules", () => {
    expect(bestThirdsTarget(wc)).toBe(8);
    expect(bestThirdsTarget(rwc)).toBe(4);
    expect(bestThirdsTarget({ advancement: { automatic_per_group: 2, wildcard_third: 0, wildcard_fourth: 0 } })).toBe(0);
  });
});

describe("teamWorldRank", () => {
  it("prefers world_rank, falls back to fifa_rank, then 99", () => {
    expect(teamWorldRank({ fifa_rank: 30, world_rank: 3 })).toBe(3);
    expect(teamWorldRank({ fifa_rank: 30 })).toBe(30);
    expect(teamWorldRank(undefined)).toBe(99);
  });
});

describe("rankThirds for Rugby World Cup 2027", () => {
  it("orders by points, points difference, points scored, tries scored, then World Rugby ranking", () => {
    // Pool thirds, all different on exactly one criterion from the next.
    const rows = [
      third("A", standing("CHI", { points: 5, diff: -10, scored: 40, tries: 4 })),
      third("B", standing("GEO", { points: 6, diff: -30, scored: 30, tries: 3 })),
      third("C", standing("ESP", { points: 5, diff: -10, scored: 45, tries: 2 })),
      third("D", standing("URU", { points: 5, diff: -5, scored: 20, tries: 1 })),
      third("E", standing("USA", { points: 5, diff: -10, scored: 40, tries: 5 })),
      third("F", standing("TGA", { points: 5, diff: -10, scored: 40, tries: 4 })),
    ];
    const order = rankThirds(rwc, rows).map((r) => r.standing.teamCode);
    // GEO on points; URU on points difference; ESP on points scored; USA on
    // tries; CHI (world rank 17) ahead of TGA (18) with everything level.
    expect(order).toEqual(["GEO", "URU", "ESP", "USA", "CHI", "TGA"]);
    expect(selectBestThirds(rwc, rows)).toEqual(["GEO", "URU", "ESP", "USA"]);
  });

  it("does not mutate its input", () => {
    const rows = [
      third("A", standing("CHI", { points: 1 })),
      third("B", standing("GEO", { points: 9 })),
    ];
    const copy = [...rows];
    rankThirds(rwc, rows);
    expect(rows).toEqual(copy);
  });
});

describe("rankThirds for the 2026 World Cup", () => {
  it("orders by points, goal difference, goals scored, then FIFA rank and team code", () => {
    const rows = [
      third("A", standing("MEX", { points: 4, diff: 0, scored: 3 })),
      third("B", standing("CAN", { points: 4, diff: 0, scored: 3 })),
      third("C", standing("BRA", { points: 3, diff: 2, scored: 5 })),
      third("D", standing("USA", { points: 4, diff: 1, scored: 2 })),
      third("E", standing("GER", { points: 4, diff: 0, scored: 4 })),
    ];
    const order = rankThirds(wc, rows).map((r) => r.standing.teamCode);
    const rank = (id: string) => teamWorldRank(wc.teams.find((t) => t.id === id));
    // Tries never apply; USA on goal difference, GER on goals, then the
    // MEX/CAN tie falls to FIFA rank, and BRA last on points.
    const [mexCanFirst, mexCanSecond] = rank("MEX") <= rank("CAN") ? ["MEX", "CAN"] : ["CAN", "MEX"];
    expect(order).toEqual(["USA", "GER", mexCanFirst, mexCanSecond, "BRA"]);
  });
});

describe("labels", () => {
  it("names the ranking authority per sport", () => {
    expect(rankingLabel(wc)).toMatchObject({ short: "FR", body: "FIFA" });
    expect(rankingLabel(rwc)).toMatchObject({ short: "WR", body: "World Rugby" });
  });

  it("lists the cross-group criteria in the organiser's order", () => {
    expect(thirdsTiebreakLabels(wc)).toEqual(["goal difference", "goals scored"]);
    expect(thirdsTiebreakLabels(rwc)).toEqual([
      "points difference",
      "points scored",
      "tries scored",
      "World Rugby ranking",
    ]);
  });

  it("names the round the thirds enter", () => {
    expect(thirdsEntryStageLabel(wc)).toBe("Round of 32");
    expect(thirdsEntryStageLabel(rwc)).toBe("Round of 16");
    expect(thirdsEntryStageLabel({ ...rwc, knockouts: [] })).toBe("the knockout rounds");
  });
});
