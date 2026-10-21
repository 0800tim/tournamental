import { describe, expect, it } from "vitest";

import { bracketToCascadeInput } from "../src/bridge.js";
import { loadFixtures2026 } from "../src/fixtures-loader.js";
import type { Bracket, MatchPrediction } from "../src/tournament.js";

const tournament = loadFixtures2026();
const groupA = tournament.groups[0]!;
const fixturesA = tournament.group_fixtures.filter((f) => f.group_id === groupA.id);

function pick(matchNo: number, outcome: MatchPrediction["outcome"]): [string, MatchPrediction] {
  return [String(matchNo), { matchId: String(matchNo), outcome, lockedAt: "2026-05-15T00:00:00Z" }];
}

function bracket(overrides: Partial<Bracket> = {}): Bracket {
  return {
    bracketId: "b1",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 1,
    ...overrides,
  };
}

describe("bracketToCascadeInput", () => {
  it("emits an empty order for a group until every fixture in it is predicted", () => {
    const partial = Object.fromEntries(fixturesA.slice(0, -1).map((f) => pick(f.match_no, "home_win")));
    const out = bracketToCascadeInput(tournament, bracket({ matchPredictions: partial }), "u1", "2026-06-01T00:00:00Z");
    expect(out.groups.find((g) => g.group_id === groupA.id)!.order).toEqual([]);
    expect(out.groups).toHaveLength(tournament.groups.length);
    expect(out.tournament_id).toBe(tournament.id);
    expect(out.user_id).toBe("u1");
  });

  it("emits the computed finishing order once the group is complete", () => {
    // Every home side wins, so a team's points are 3 x its home fixtures;
    // the emitted order must be a permutation of the group that never
    // puts a team with fewer home wins above one with more.
    const full = Object.fromEntries(fixturesA.map((f) => pick(f.match_no, "home_win")));
    const out = bracketToCascadeInput(tournament, bracket({ matchPredictions: full }), "u1", "2026-06-01T00:00:00Z");
    const order = out.groups.find((g) => g.group_id === groupA.id)!.order;
    expect([...order].sort()).toEqual([...groupA.team_ids].sort());
    const homeWins = new Map<string, number>();
    for (const f of fixturesA) {
      const home = groupA.team_ids[f.home_idx]!;
      homeWins.set(home, (homeWins.get(home) ?? 0) + 1);
    }
    for (let i = 1; i < order.length; i++) {
      expect(homeWins.get(order[i]!) ?? 0).toBeLessThanOrEqual(homeWins.get(order[i - 1]!) ?? 0);
    }
  });

  it("passes the user's best thirds through and never derives them", () => {
    const out = bracketToCascadeInput(tournament, bracket({ bestThirds: ["ARG", "FRA"] }), "u1", "2026-06-01T00:00:00Z");
    expect(out.best_thirds).toEqual(["ARG", "FRA"]);
    expect(out.best_fourths).toEqual([]);
    expect(out.knockouts).toEqual([]);
    expect(out.locks).toEqual([]);
    expect(bracketToCascadeInput(tournament, bracket(), "u1", "2026-06-01T00:00:00Z").best_thirds).toEqual([]);
  });

  it("stamps updated_at_utc from lockedAt, else the supplied now, else the clock", () => {
    expect(bracketToCascadeInput(tournament, bracket({ lockedAt: "2026-06-10T00:00:00Z" }), "u1", "2026-06-01T00:00:00Z").updated_at_utc).toBe("2026-06-10T00:00:00Z");
    expect(bracketToCascadeInput(tournament, bracket(), "u1", "2026-06-01T00:00:00Z").updated_at_utc).toBe("2026-06-01T00:00:00Z");
    expect(bracketToCascadeInput(tournament, bracket(), "u1").updated_at_utc).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("applies a user tiebreaker to a complete group", () => {
    const allDraws = Object.fromEntries(fixturesA.map((f) => pick(f.match_no, "draw")));
    const ranked = [...groupA.team_ids].reverse() as [string, string, string, string];
    const out = bracketToCascadeInput(
      tournament,
      bracket({ matchPredictions: allDraws, groupTiebreakers: { [groupA.id]: { groupId: groupA.id, rankedTeams: ranked, setAt: "2026-06-01T00:00:00Z" } } }),
      "u1",
      "2026-06-01T00:00:00Z",
    );
    expect(out.groups.find((g) => g.group_id === groupA.id)!.order).toEqual(ranked);
  });
});
