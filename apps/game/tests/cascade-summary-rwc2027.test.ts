/**
 * The share-page summary's knockout path lists only the rounds the
 * tournament plays: Rugby World Cup 2027 starts at a Round of 16, so no
 * permanent "r32: tbd" row; the 2026 World Cup keeps all five.
 */
import { describe, expect, it } from "vitest";
import {
  computeGroupStandings,
  loadFixtures2026,
  loadFixturesRwc2027,
  type Bracket,
  type MatchPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

import { resolveCascadeForSummary, summariseFromCascade } from "../src/routes/bracket-cascade-summary.js";

function pick(matchId: string, outcome: MatchPrediction["outcome"] = "home_win"): MatchPrediction {
  return { matchId, outcome, lockedAt: "2027-09-01T00:00:00Z" };
}

/** Every fixture a home win: complete pools, a full knockout path. */
function fullBracket(t: Tournament): Bracket {
  const matchPredictions = Object.fromEntries(
    t.group_fixtures.map((f) => [String(f.match_no), pick(String(f.match_no))]),
  );
  const bestThirds = t.groups
    .slice(0, t.advancement.wildcard_third)
    .map((g) => computeGroupStandings(g.id, t, matchPredictions)[2]!.teamCode);
  const knockoutPredictions = Object.fromEntries(t.knockouts.map((k) => [k.id, pick(k.id)]));
  return {
    bracketId: "b-rwc",
    matchPredictions,
    groupTiebreakers: {},
    knockoutPredictions,
    bestThirds,
    version: 1,
  };
}

describe("summariseFromCascade knockout path per tournament", () => {
  it("lists r16, qf, sf and final for Rugby World Cup 2027, with no r32 row", () => {
    const rwc = loadFixturesRwc2027();
    const summary = summariseFromCascade(resolveCascadeForSummary(rwc, fullBracket(rwc)));
    expect(summary.champion_code).not.toBeNull();
    expect(summary.knockout_path.map((e) => e.stage)).toEqual(["r16", "qf", "sf", "final"]);
    // A full bracket resolves the champion's opponent at every round.
    for (const entry of summary.knockout_path) {
      expect(entry.opponent_code).not.toBeNull();
      expect(entry.result).toBe("win");
    }
  });

  it("keeps all five rounds for the 2026 World Cup", () => {
    const wc = loadFixtures2026();
    const summary = summariseFromCascade(resolveCascadeForSummary(wc, fullBracket(wc)));
    expect(summary.knockout_path.map((e) => e.stage)).toEqual(["r32", "r16", "qf", "sf", "final"]);
  });

  it("still lists the tournament's rounds as tbd when the bracket is empty", () => {
    const rwc = loadFixturesRwc2027();
    const empty: Bracket = { bracketId: "b0", matchPredictions: {}, groupTiebreakers: {}, knockoutPredictions: {}, version: 1 };
    const summary = summariseFromCascade(resolveCascadeForSummary(rwc, empty));
    expect(summary.champion_code).toBeNull();
    expect(summary.knockout_path).toEqual(
      ["r16", "qf", "sf", "final"].map((stage) => ({ stage, opponent_code: null, result: "tbd" })),
    );
  });
});
