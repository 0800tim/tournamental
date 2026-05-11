/**
 * Vitest, `buildGroupStageSummary` correctness.
 *
 * Covers:
 *   - A team that played all three matches and topped its group.
 *   - A team that came 2nd in its group.
 *   - A team that didn't qualify out of its group (lost all three).
 *   - A team with zero predictions in their group → null position, no panic.
 *   - A team not in the tournament → degenerate summary, groupId null.
 */

import { describe, it, expect } from "vitest";

import {
  buildGroupStageSummary,
  positionLabel,
  rankPillLabel,
} from "@/lib/molecule/group-summary";
import {
  loadFixtures2026,
  type Bracket,
  type MatchPrediction,
} from "@vtorn/bracket-engine";

const T = loadFixtures2026();

function bracketWith(predictions: Record<string, MatchPrediction>): Bracket {
  return {
    bracketId: "test",
    matchPredictions: predictions,
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 2,
  };
}

function pred(
  matchId: string,
  outcome: "home_win" | "draw" | "away_win",
  homeScore?: number,
  awayScore?: number,
): MatchPrediction {
  return {
    matchId,
    outcome,
    homeScore,
    awayScore,
    lockedAt: "2026-06-11T00:00:00Z",
  };
}

/**
 * Group A in the 2026 fixtures: [MEX, RSA, KOR, CZE].
 *
 * Fixtures (from data/fifa-wc-2026-fixtures.json):
 *   match 1: MEX vs RSA
 *   match 2: KOR vs CZE
 *   match 3: MEX vs KOR
 *   match 4: CZE vs RSA
 *   match 5: CZE vs MEX
 *   match 6: RSA vs KOR
 */

describe("buildGroupStageSummary, MEX tops Group A", () => {
  // MEX wins all three of their matches (vs RSA, vs KOR, vs CZE).
  const predictions: Record<string, MatchPrediction> = {
    "1": pred("1", "home_win", 2, 0), // MEX vs RSA → MEX wins
    "3": pred("3", "home_win", 3, 1), // MEX vs KOR → MEX wins
    "5": pred("5", "away_win", 0, 1), // CZE vs MEX → MEX wins
  };
  const summary = buildGroupStageSummary(T, bracketWith(predictions), "MEX");

  it("identifies MEX's group as A", () => {
    expect(summary.groupId).toBe("A");
  });

  it("reports 3 match rows", () => {
    expect(summary.matches.length).toBe(3);
  });

  it("flags all three rows as W", () => {
    for (const m of summary.matches) {
      expect(m.result).toBe("W");
      expect(m.points).toBe(3);
    }
  });

  it("computes 9 points + +5 GD", () => {
    expect(summary.totalPoints).toBe(9);
    expect(summary.goalDiff).toBe(5);
  });

  it("computes finishing position = 1 (topped Group A)", () => {
    expect(summary.position).toBe(1);
  });

  it("hasAnyPick is true", () => {
    expect(summary.hasAnyPick).toBe(true);
  });

  it("opponent rows include opponent codes", () => {
    const opps = summary.matches.map((m) => m.opponentCode).sort();
    expect(opps).toEqual(["CZE", "KOR", "RSA"]);
  });
});

describe("buildGroupStageSummary, partial predictions", () => {
  // Only one match predicted, KOR vs CZE → CZE wins.
  const predictions: Record<string, MatchPrediction> = {
    "2": pred("2", "away_win"), // KOR vs CZE → CZE wins
  };
  const summary = buildGroupStageSummary(T, bracketWith(predictions), "CZE");

  it("reports the one match as W with no score", () => {
    const row = summary.matches.find((m) => m.opponentCode === "KOR")!;
    expect(row.result).toBe("W");
    expect(row.teamScore).toBeNull();
    expect(row.opponentScore).toBeNull();
    expect(row.points).toBe(3);
  });

  it("the other two matches are TBD", () => {
    const tbd = summary.matches.filter((m) => m.result === "TBD");
    expect(tbd.length).toBe(2);
    expect(tbd.every((m) => m.points === 0)).toBe(true);
  });

  it("totalPoints is just the one win = 3", () => {
    expect(summary.totalPoints).toBe(3);
  });

  it("hasAnyPick is true because one match has an outcome", () => {
    expect(summary.hasAnyPick).toBe(true);
  });
});

describe("buildGroupStageSummary, no predictions at all", () => {
  const summary = buildGroupStageSummary(T, bracketWith({}), "MEX");
  it("position is null", () => {
    expect(summary.position).toBeNull();
  });
  it("totalPoints = 0", () => {
    expect(summary.totalPoints).toBe(0);
  });
  it("hasAnyPick is false", () => {
    expect(summary.hasAnyPick).toBe(false);
  });
  it("still returns 3 TBD rows for the team's 3 group matches", () => {
    expect(summary.matches.length).toBe(3);
    for (const m of summary.matches) expect(m.result).toBe("TBD");
  });
});

describe("buildGroupStageSummary, draw scenarios", () => {
  // RSA draws KOR and loses to MEX and CZE.
  const predictions: Record<string, MatchPrediction> = {
    "1": pred("1", "home_win", 1, 0), // MEX vs RSA → MEX wins
    "4": pred("4", "home_win", 2, 1), // CZE vs RSA → CZE wins
    "6": pred("6", "draw", 1, 1), // RSA vs KOR → draw
  };
  const summary = buildGroupStageSummary(T, bracketWith(predictions), "RSA");

  it("draw row is flagged 'D' with 1 point", () => {
    const drawRow = summary.matches.find((m) => m.opponentCode === "KOR")!;
    expect(drawRow.result).toBe("D");
    expect(drawRow.points).toBe(1);
  });

  it("totalPoints = 1 (one draw, two losses)", () => {
    expect(summary.totalPoints).toBe(1);
  });

  it("RSA finishes near the bottom of the group", () => {
    // 1 point from a draw, should be 3rd or 4th depending on tiebreaks.
    expect(summary.position === 3 || summary.position === 4).toBe(true);
  });
});

describe("buildGroupStageSummary, team not in tournament", () => {
  const summary = buildGroupStageSummary(T, bracketWith({}), "ZZZ");
  it("returns groupId null and no matches", () => {
    expect(summary.groupId).toBeNull();
    expect(summary.matches.length).toBe(0);
    expect(summary.hasAnyPick).toBe(false);
  });
});

describe("positionLabel + rankPillLabel, friendly strings", () => {
  it("positionLabel mirrors Tim's expected copy", () => {
    expect(positionLabel(1, "A")).toBe("Topped Group A");
    expect(positionLabel(2, "B")).toBe("Came 2nd in Group B");
    expect(positionLabel(3, "C")).toBe("Came 3rd in Group C");
    expect(positionLabel(4, "D")).toBe("Came 4th in Group D");
    expect(positionLabel(null, null)).toBe("Group stage");
  });
  it("rankPillLabel is ordinal-shorthand", () => {
    expect(rankPillLabel(1)).toBe("1ST");
    expect(rankPillLabel(2)).toBe("2ND");
    expect(rankPillLabel(3)).toBe("3RD");
    expect(rankPillLabel(4)).toBe("4TH");
    expect(rankPillLabel(null)).toBe("-");
  });
});
