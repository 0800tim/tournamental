/**
 * The public share-page summariser: champion, runner-up, bronze and
 * the champion's path, resolved by cascading a saved per-match Bracket
 * against the 2026 fixtures. Two real bugs lived here (2026-05-11: the
 * summary parsed team codes out of match ids and found none; 2026-06-11:
 * the server derived best thirds itself and disagreed with the builder),
 * and nothing covered the helpers directly.
 */
import { describe, expect, it } from "vitest";

import { computeGroupStandings, loadFixtures2026, type Bracket, type MatchPrediction } from "@tournamental/bracket-engine";

import { resolveCascadeForSummary, summariseFromCascade } from "../src/routes/bracket-cascade-summary.js";

const tournament = loadFixtures2026();

function pick(matchId: string, outcome: MatchPrediction["outcome"] = "home_win"): MatchPrediction {
  return { matchId, outcome, lockedAt: "2026-06-01T00:00:00Z" };
}

/** Every group fixture a home win, so each group has a clear order. */
function allGroupPicks(): Record<string, MatchPrediction> {
  return Object.fromEntries(tournament.group_fixtures.map((f) => [String(f.match_no), pick(String(f.match_no))]));
}

/** The eight best thirds the way the builder stores them: the user's own list. */
function thirdsFromStandings(matchPredictions: Record<string, MatchPrediction>): string[] {
  return tournament.groups
    .slice(0, tournament.advancement.wildcard_third)
    .map((g) => computeGroupStandings(g.id, tournament, matchPredictions)[2]!.teamCode);
}

function bracket(overrides: Partial<Bracket>): Bracket {
  return { bracketId: "b1", matchPredictions: {}, groupTiebreakers: {}, knockoutPredictions: {}, version: 1, ...overrides };
}

describe("resolveCascadeForSummary", () => {
  it("resolves every knockout down to the final when the bracket is complete", () => {
    const matchPredictions = allGroupPicks();
    const b = bracket({
      matchPredictions,
      bestThirds: thirdsFromStandings(matchPredictions),
      knockoutPredictions: Object.fromEntries(tournament.knockouts.map((k) => [k.id, pick(k.id)])),
    });
    const cascaded = resolveCascadeForSummary(tournament, b);
    expect(cascaded.warnings).toEqual([]);
    for (const k of cascaded.knockouts) {
      expect(k.home.team, `${k.id} home`).not.toBeNull();
      expect(k.away.team, `${k.id} away`).not.toBeNull();
      expect(k.effective_winner, `${k.id} winner`).toBe(k.home.team);
    }
  });

  it("leaves knockouts unresolved while a group is incomplete, and ignores picks for unknown match ids", () => {
    const matchPredictions = allGroupPicks();
    const firstGroup = tournament.group_fixtures.find((f) => f.group_id === tournament.groups[0]!.id)!;
    delete matchPredictions[String(firstGroup.match_no)];
    const b = bracket({
      matchPredictions,
      bestThirds: [],
      knockoutPredictions: { ...Object.fromEntries(tournament.knockouts.map((k) => [k.id, pick(k.id)])), bogus: pick("bogus") },
    });
    const cascaded = resolveCascadeForSummary(tournament, b);
    const groupA = cascaded.groups.find((g) => g.group_id === tournament.groups[0]!.id)!;
    expect(groupA.effective_order).toEqual([]);
    const final = cascaded.knockouts.find((k) => k.stage === "f")!;
    expect(final.home.team).toBeNull();
    expect(final.effective_winner).toBeNull();
    expect(cascaded.knockouts.some((k) => k.id === "bogus")).toBe(false);
  });

  it("is deterministic across calls", () => {
    const matchPredictions = allGroupPicks();
    const b = bracket({
      matchPredictions,
      bestThirds: thirdsFromStandings(matchPredictions),
      knockoutPredictions: Object.fromEntries(tournament.knockouts.map((k) => [k.id, pick(k.id, "away_win")])),
      lockedAt: "2026-06-10T00:00:00Z",
    });
    const a = resolveCascadeForSummary(tournament, b);
    const c = resolveCascadeForSummary(tournament, b);
    expect(c.knockouts.map((k) => k.effective_winner)).toEqual(a.knockouts.map((k) => k.effective_winner));
    expect(a.knockouts.find((k) => k.stage === "f")!.effective_winner).not.toBeNull();
  });
});

describe("summariseFromCascade", () => {
  it("names champion, runner-up and bronze, and the champion's path as five wins", () => {
    const matchPredictions = allGroupPicks();
    const b = bracket({
      matchPredictions,
      bestThirds: thirdsFromStandings(matchPredictions),
      knockoutPredictions: Object.fromEntries(tournament.knockouts.map((k) => [k.id, pick(k.id)])),
    });
    const cascaded = resolveCascadeForSummary(tournament, b);
    const s = summariseFromCascade(cascaded);
    const final = cascaded.knockouts.find((k) => k.stage === "f")!;
    const tp = cascaded.knockouts.find((k) => k.stage === "tp")!;
    expect(s.champion_code).toBe(final.home.team);
    expect(s.runner_up_code).toBe(final.away.team);
    expect(s.third_place_code).toBe(tp.home.team);
    expect(s.champion_code).not.toBe(s.runner_up_code);
    expect(s.third_place_code).not.toBe(s.champion_code);
    expect(s.knockout_path.map((p) => p.stage)).toEqual(["r32", "r16", "qf", "sf", "final"]);
    for (const step of s.knockout_path) {
      expect(step.result).toBe("win");
      expect(step.opponent_code).not.toBeNull();
      expect(step.opponent_code).not.toBe(s.champion_code);
    }
    expect(new Set(s.knockout_path.map((p) => p.opponent_code)).size).toBe(5);
  });

  it("returns nulls and a tbd path when the final is unresolved", () => {
    const b = bracket({ matchPredictions: allGroupPicks(), bestThirds: [] });
    const s = summariseFromCascade(resolveCascadeForSummary(tournament, b));
    expect(s.champion_code).toBeNull();
    expect(s.runner_up_code).toBeNull();
    expect(s.third_place_code).toBeNull();
    expect(s.knockout_path).toHaveLength(5);
    expect(s.knockout_path.every((p) => p.result === "tbd" && p.opponent_code === null)).toBe(true);
  });

  it("leaves bronze null when only the third-place play-off is unpicked", () => {
    const matchPredictions = allGroupPicks();
    const knockoutPredictions = Object.fromEntries(tournament.knockouts.filter((k) => k.stage !== "tp").map((k) => [k.id, pick(k.id)]));
    const b = bracket({ matchPredictions, bestThirds: thirdsFromStandings(matchPredictions), knockoutPredictions });
    const s = summariseFromCascade(resolveCascadeForSummary(tournament, b));
    expect(s.champion_code).not.toBeNull();
    expect(s.third_place_code).toBeNull();
  });
});
