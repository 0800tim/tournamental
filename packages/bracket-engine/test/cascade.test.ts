/**
 * Cascade calculator tests. Determinism, partial-prediction handling,
 * actual-results override, withdrawal handling, and the wildcard pool.
 */

import { describe, expect, it } from "vitest";

import { cascade } from "../src/cascade.js";
import type {
  BracketPrediction,
  CompletedResults,
  Tournament,
} from "../src/tournament.js";
import { loadFixtures2026 } from "../src/fixtures-loader.js";

const tournament: Tournament = loadFixtures2026();

function emptyPrediction(): BracketPrediction {
  return {
    tournament_id: tournament.id,
    user_id: "u_test",
    groups: [],
    best_thirds: [],
    best_fourths: [],
    knockouts: [],
    locks: [],
    updated_at_utc: "2026-05-15T00:00:00Z",
  };
}

function fullGroupPicks(): BracketPrediction["groups"] {
  // Pick the canonical team_ids order as the predicted finishing order in
  // every group. Deterministic, easy to assert against.
  return tournament.groups.map((g) => ({
    group_id: g.id,
    order: [...g.team_ids],
  }));
}

describe("cascade — determinism", () => {
  it("same inputs always produce identical output", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const a = cascade(tournament, pred);
    const b = cascade(tournament, pred);
    // Stringify so deep-equal nested arrays + sort order is implied by structure
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("groups are returned in canonical alphabetical order", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const c = cascade(tournament, pred);
    expect(c.groups.map((g) => g.group_id)).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
    ]);
  });

  it("knockouts are returned in match-number order", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const c = cascade(tournament, pred);
    const matchNos = c.knockouts.map((k) => k.match_no);
    const sorted = [...matchNos].sort((a, b) => a - b);
    expect(matchNos).toEqual(sorted);
  });
});

describe("cascade — partial predictions", () => {
  it("returns null occupants when group standings aren't picked", () => {
    const pred = emptyPrediction();
    const c = cascade(tournament, pred);
    // R32 matches that depend on group_position should have null teams
    const r32 = c.knockouts.filter((k) => k.stage === "r32");
    const allNullSlots = r32.every((k) => k.home.team === null && k.away.team === null);
    expect(allNullSlots).toBe(true);
  });

  it("warns when group prediction is missing", () => {
    const pred = emptyPrediction();
    const c = cascade(tournament, pred);
    expect(c.warnings.some((w) => w.code === "missing_group_prediction")).toBe(true);
  });

  it("populates downstream R16 slots from R32 predicted winners", () => {
    // Pick winners for r32_01 and r32_02. r16_01 depends on these.
    const r32_01 = tournament.knockouts.find((k) => k.id === "r32_01")!;
    const r32_02 = tournament.knockouts.find((k) => k.id === "r32_02")!;
    // Pick the home team of each r32 match as the winner (deterministic).
    const r32_01_home = tournament.groups.find((g) => g.id === (r32_01.home as { group?: string }).group)!;
    const r32_02_home = tournament.groups.find((g) => g.id === (r32_02.home as { group?: string }).group)!;
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: fullGroupPicks(),
      knockouts: [
        { match_id: "r32_01", winner: r32_01_home.team_ids[0] },
        { match_id: "r32_02", winner: r32_02_home.team_ids[0] },
      ],
    };
    const c = cascade(tournament, pred);
    const r16_01 = c.knockouts.find((k) => k.id === "r16_01")!;
    expect(r16_01.home.team).toBe(r32_01_home.team_ids[0]);
    expect(r16_01.away.team).toBe(r32_02_home.team_ids[0]);
  });
});

describe("cascade — live recalc on actual results", () => {
  it("settled group results override the user's predicted order", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    // User picked group A in canonical order. Simulate that the actual
    // result was the reverse.
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const reversed = [...groupA.team_ids].reverse();
    const completed: CompletedResults = {
      groups: [{ group_id: "A", final_order: reversed, settled: true }],
      knockouts: [],
    };
    const c = cascade(tournament, pred, completed);
    const a = c.groups.find((g) => g.group_id === "A")!;
    expect(a.settled).toBe(true);
    expect(a.effective_order).toEqual(reversed);
  });

  it("settled knockout result overrides predicted winner downstream", () => {
    const r32_01 = tournament.knockouts.find((k) => k.id === "r32_01")!;
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const groupB = tournament.groups.find((g) => g.id === "B")!;
    // User predicts A1 wins r32_01.
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: fullGroupPicks(),
      knockouts: [{ match_id: "r32_01", winner: groupA.team_ids[0] }],
    };
    void r32_01;

    // But the actual r32_01 winner was B2.
    const completed: CompletedResults = {
      groups: [],
      knockouts: [{ match_id: "r32_01", winner: groupB.team_ids[1], settled: true }],
    };
    const c = cascade(tournament, pred, completed);
    const r32_01_cascaded = c.knockouts.find((k) => k.id === "r32_01")!;
    expect(r32_01_cascaded.actual_winner).toBe(groupB.team_ids[1]);
    expect(r32_01_cascaded.effective_winner).toBe(groupB.team_ids[1]);
    // And r16_01.home (which sources from r32_01_winner) should reflect the actual.
    const r16_01 = c.knockouts.find((k) => k.id === "r16_01")!;
    expect(r16_01.home.team).toBe(groupB.team_ids[1]);
    expect(r16_01.home.from_actual).toBe(true);
  });
});

describe("cascade — committed-team tally", () => {
  it("counts (automatic_per_group * 12) + wildcards + all knockout winners", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const c = cascade(tournament, pred);
    // 12 groups * 2 advancing = 24 + 8 best-thirds + 0 best-fourths
    // + 32 knockouts (16 R32 + 8 R16 + 4 QF + 2 SF + 1 third-place + 1 final) = 64
    expect(c.committed_total_required).toBe(
      tournament.advancement.automatic_per_group * tournament.groups.length +
        tournament.advancement.wildcard_third +
        tournament.advancement.wildcard_fourth +
        tournament.knockouts.length,
    );
  });

  it("returns committed team list de-duplicated and sorted", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const c = cascade(tournament, pred);
    const sorted = [...c.committed_teams].sort();
    expect(c.committed_teams).toEqual(sorted);
    const unique = new Set(c.committed_teams);
    expect(unique.size).toBe(c.committed_teams.length);
  });

  it("with no knockout picks, committed list is just the group-stage advancers", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const c = cascade(tournament, pred);
    // 12 groups * 2 advancing = 24 distinct team ids
    expect(c.committed_teams.length).toBe(
      tournament.advancement.automatic_per_group * tournament.groups.length,
    );
  });
});

describe("cascade — withdrawal & edge cases", () => {
  it("flags matches affected by withdrawals", () => {
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: fullGroupPicks(),
      knockouts: [{ match_id: "r32_01", winner: groupA.team_ids[0] }],
    };
    const completed: CompletedResults = {
      groups: [],
      knockouts: [],
      withdrawn: [groupA.team_ids[0]],
    };
    const c = cascade(tournament, pred, completed);
    const r32_01 = c.knockouts.find((k) => k.id === "r32_01")!;
    expect(r32_01.affected_by_withdrawal).toBe(true);
    expect(c.warnings.some((w) => w.code === "withdrawn_team_advancing")).toBe(true);
  });

  it("rejects winners that aren't in the resolved match (warning, not crash)", () => {
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: fullGroupPicks(),
      knockouts: [{ match_id: "r32_01", winner: "TOTALLY_FAKE_TEAM" }],
    };
    const c = cascade(tournament, pred);
    expect(c.warnings.some((w) => w.code === "winner_not_in_match")).toBe(true);
    const r32_01 = c.knockouts.find((k) => k.id === "r32_01")!;
    expect(r32_01.predicted_winner).toBe(null);
  });

  it("handles tied group standings (user-supplied order is the tie-break)", () => {
    // The engine doesn't model ties internally — the user's predicted order
    // IS the tie-break (in real life, FIFA settles ties by goal diff etc).
    // Two different orders → two different cascades; same order → same.
    const pred1: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const pred2: BracketPrediction = {
      ...emptyPrediction(),
      groups: tournament.groups.map((g) => ({
        group_id: g.id,
        order: [...g.team_ids].slice().reverse(),
      })),
    };
    const c1 = cascade(tournament, pred1);
    const c2 = cascade(tournament, pred2);
    // R32 home slots differ
    const r32_01_a = c1.knockouts.find((k) => k.id === "r32_01")!;
    const r32_01_b = c2.knockouts.find((k) => k.id === "r32_01")!;
    expect(r32_01_a.home.team).not.toBe(r32_01_b.home.team);
  });

  it("warns on duplicate team in group prediction", () => {
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const dup = groupA.team_ids[0];
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: [
        { group_id: "A", order: [dup, dup, ...groupA.team_ids.slice(2)] },
        ...tournament.groups.filter((g) => g.id !== "A").map((g) => ({
          group_id: g.id,
          order: [...g.team_ids],
        })),
      ],
    };
    const c = cascade(tournament, pred);
    expect(c.warnings.some((w) => w.code === "duplicate_team_in_group")).toBe(true);
  });

  it("warns on team-not-in-group", () => {
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const groupB = tournament.groups.find((g) => g.id === "B")!;
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: [
        { group_id: "A", order: [groupB.team_ids[0], ...groupA.team_ids.slice(1)] },
        ...tournament.groups.filter((g) => g.id !== "A").map((g) => ({
          group_id: g.id,
          order: [...g.team_ids],
        })),
      ],
    };
    const c = cascade(tournament, pred);
    expect(c.warnings.some((w) => w.code === "team_not_in_group")).toBe(true);
  });

  it("supports knockout_loser slots (3rd place playoff)", () => {
    const pred: BracketPrediction = { ...emptyPrediction(), groups: fullGroupPicks() };
    const tp = tournament.knockouts.find((k) => k.id === "tp_01")!;
    expect(tp.home.kind).toBe("knockout_loser");
    // sf_01's predicted winner determines who's the loser. Without a pick it's null.
    const c = cascade(tournament, pred);
    const tpc = c.knockouts.find((k) => k.id === "tp_01")!;
    expect(tpc.home.team).toBe(null);
  });
});

describe("cascade — wildcard pools", () => {
  it("uses explicit best_thirds picks when supplied", () => {
    const groupA = tournament.groups.find((g) => g.id === "A")!;
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: fullGroupPicks(),
      best_thirds: [groupA.team_ids[2]],
    };
    const c = cascade(tournament, pred);
    // First R32 match whose home slot is a `best_third` — find it
    // dynamically since slot ordering depends on the FIFA bracket layout.
    const firstBestThirdMatch = c.knockouts.find(
      (k) => k.stage === "r32" && k.home.source.kind === "best_third",
    )!;
    expect(firstBestThirdMatch.home.team).toBe(groupA.team_ids[2]);
  });

  it("warns when wildcard slots are unfilled", () => {
    const pred: BracketPrediction = {
      ...emptyPrediction(),
      groups: tournament.groups.map((g) => ({
        group_id: g.id,
        order: [...g.team_ids].slice(0, 2), // only top-2 picked, no 3rd or 4th
      })),
    };
    const c = cascade(tournament, pred);
    expect(c.warnings.some((w) => w.code === "missing_wildcard_pick")).toBe(true);
  });
});
