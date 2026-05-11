/**
 * Vitest — `buildMoleculeLayout` deterministic layout assertions.
 *
 * v4 multi-instance pyramid edition. Each team now contributes one node
 * per surviving layer (so a champion has 7 instances, an R32 loser has
 * 2, a group-out team has 1). These tests cover:
 *
 *   1. Champion's *top instance* (stage === "champion") sits at the apex.
 *   2. With an empty bracket, every team has exactly one instance (group).
 *   3. Group-stage eliminated teams stay on the base ring.
 *   4. Palette colour per stage is sane.
 *   5. Bonds: one match bond per group fixture + one per resolved knockout
 *      (excluding the 3rd-place playoff which has no dedicated v4 layer).
 *   6. Layout is deterministic — same inputs, same output.
 */

import { describe, it, expect } from "vitest";

import {
  buildMoleculeLayout,
  PALETTE,
  RING_RADII_TEST_ONLY,
  isAtOrigin,
  isOnGroupRing,
  stableHash01,
  type MoleculeLayout,
  type MoleculeNode,
} from "@/lib/molecule/layout";
import {
  cascade,
  loadFixtures2026,
  type Bracket,
  type BracketPrediction,
  type Tournament,
} from "@vtorn/bracket-engine";

function emptyBracket(): Bracket {
  return {
    bracketId: "test",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 2,
  };
}

function emptyPrediction(t: Tournament): BracketPrediction {
  return {
    tournament_id: t.id,
    user_id: "test",
    groups: t.groups.map((g) => ({ group_id: g.id, order: [] })),
    best_thirds: [],
    best_fourths: [],
    knockouts: [],
    locks: [],
    updated_at_utc: "2026-05-12T00:00:00Z",
  };
}

function topInstance(layout: MoleculeLayout, teamCode: string): MoleculeNode | undefined {
  return layout.nodes.find((n) => n.teamCode === teamCode && n.isTopInstance);
}

describe("buildMoleculeLayout — empty bracket (v4)", () => {
  const t = loadFixtures2026();
  const empty = cascade(t, emptyPrediction(t));
  const layout = buildMoleculeLayout(t, empty);

  it("renders exactly one node per team (group-only) when no knockouts resolved", () => {
    // Empty bracket: every team is at "group" stage. v4 emits one
    // instance per surviving layer, so each team has exactly 1 node.
    expect(layout.nodes.length).toBe(t.teams.length);
  });

  it("places every team on the outermost group ring when no picks exist", () => {
    for (const n of layout.nodes) {
      expect(n.finalStage).toBe("group");
      expect(n.stage).toBe("group");
      expect(n.isTopInstance).toBe(true);
      expect(isOnGroupRing(n)).toBe(true);
    }
  });

  it("emits the group-stage match bonds for every group fixture", () => {
    const groupBonds = layout.bonds.filter((b) => b.stage === "group" && b.kind === "match");
    expect(groupBonds.length).toBe(t.group_fixtures.length);
  });

  it("does not crash on empty predictions and signals no knockout picks yet", () => {
    expect(layout.hasAnyKnockoutPick).toBe(false);
    expect(layout.championCode).toBeNull();
  });

  it("uses palette + non-empty accent colour per node", () => {
    for (const n of layout.nodes) {
      expect(typeof n.accentColor).toBe("string");
      expect(n.accentColor.length).toBeGreaterThan(0);
    }
    expect(PALETTE.group).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("buildMoleculeLayout — champion-at-apex invariant (v4)", () => {
  const t = loadFixtures2026();
  const championCode = "ARG";
  const argInTournament = t.teams.some((x) => x.id === championCode);
  expect(argInTournament).toBe(true);

  const fakeCascaded = {
    tournament_id: t.id,
    groups: t.groups.map((g) => ({
      group_id: g.id,
      predicted_order: [...g.team_ids],
      actual_order: null,
      effective_order: [...g.team_ids],
      settled: false,
    })),
    knockouts: [
      {
        id: "r32_01",
        stage: "r32" as const,
        match_no: 73,
        home: { source: { kind: "group_position" as const, group: "A", position: 1 }, team: championCode, from_actual: false },
        away: { source: { kind: "group_position" as const, group: "B", position: 2 }, team: "BRA", from_actual: false },
        predicted_winner: championCode,
        actual_winner: null,
        effective_winner: championCode,
        affected_by_withdrawal: false,
      },
      {
        id: "r16_01",
        stage: "r16" as const,
        match_no: 90,
        home: { source: { kind: "knockout_winner" as const, match_id: "r32_01" }, team: championCode, from_actual: false },
        away: { source: { kind: "knockout_winner" as const, match_id: "r32_02" }, team: "FRA", from_actual: false },
        predicted_winner: championCode,
        actual_winner: null,
        effective_winner: championCode,
        affected_by_withdrawal: false,
      },
      {
        id: "qf_01",
        stage: "qf" as const,
        match_no: 98,
        home: { source: { kind: "knockout_winner" as const, match_id: "r16_01" }, team: championCode, from_actual: false },
        away: { source: { kind: "knockout_winner" as const, match_id: "r16_02" }, team: "GER", from_actual: false },
        predicted_winner: championCode,
        actual_winner: null,
        effective_winner: championCode,
        affected_by_withdrawal: false,
      },
      {
        id: "sf_01",
        stage: "sf" as const,
        match_no: 102,
        home: { source: { kind: "knockout_winner" as const, match_id: "qf_01" }, team: championCode, from_actual: false },
        away: { source: { kind: "knockout_winner" as const, match_id: "qf_02" }, team: "ESP", from_actual: false },
        predicted_winner: championCode,
        actual_winner: null,
        effective_winner: championCode,
        affected_by_withdrawal: false,
      },
      {
        id: "tp_01",
        stage: "tp" as const,
        match_no: 103,
        home: { source: { kind: "knockout_loser" as const, match_id: "sf_01" }, team: "ESP", from_actual: false },
        away: { source: { kind: "knockout_loser" as const, match_id: "sf_02" }, team: "POR", from_actual: false },
        predicted_winner: "ESP",
        actual_winner: null,
        effective_winner: "ESP",
        affected_by_withdrawal: false,
      },
      {
        id: "final",
        stage: "f" as const,
        match_no: 104,
        home: { source: { kind: "knockout_winner" as const, match_id: "sf_01" }, team: championCode, from_actual: false },
        away: { source: { kind: "knockout_winner" as const, match_id: "sf_02" }, team: "ENG", from_actual: false },
        predicted_winner: championCode,
        actual_winner: null,
        effective_winner: championCode,
        affected_by_withdrawal: false,
      },
    ],
    locked_keys: [],
    committed_teams: [],
    committed_total_required: 0,
    warnings: [],
  };

  const layout: MoleculeLayout = buildMoleculeLayout(t, fakeCascaded);

  it("identifies the champion code", () => {
    expect(layout.championCode).toBe(championCode);
  });

  it("places the champion's top instance at the molecule apex", () => {
    const champTop = topInstance(layout, championCode);
    expect(champTop).toBeDefined();
    expect(champTop!.stage).toBe("champion");
    expect(champTop!.finalStage).toBe("champion");
    expect(isAtOrigin(champTop!)).toBe(true);
  });

  it("places the runner-up's top instance inside the group ring", () => {
    expect(layout.runnerUpCode).toBe("ENG");
    const runner = topInstance(layout, "ENG");
    expect(runner).toBeDefined();
    expect(runner!.stage).toBe("f");
    expect(runner!.finalStage).toBe("runner_up");
    const dist = Math.hypot(runner!.position[0], runner!.position[2]);
    expect(dist).toBeLessThan(RING_RADII_TEST_ONLY.group);
    // Final-layer atom is one of the two seats (radius ≈ LAYER_RADIUS.f = 2.2).
    expect(dist).toBeGreaterThan(0);
  });

  it("places the bronze (3rd-place playoff winner) at the SF tier", () => {
    expect(layout.thirdPlaceCode).toBe("ESP");
    const bronze = topInstance(layout, "ESP");
    expect(bronze).toBeDefined();
    expect(bronze!.stage).toBe("sf");
    expect(bronze!.finalStage).toBe("third_place");
  });

  it("places group-stage eliminated teams on the group ring", () => {
    const groupOut = layout.nodes.filter((n) => n.finalStage === "group");
    expect(groupOut.length).toBeGreaterThan(10);
    for (const n of groupOut) {
      expect(n.stage).toBe("group");
      expect(isOnGroupRing(n)).toBe(true);
    }
  });

  it("emits a match bond for final + sf + qf + r16 + r32 (tp skipped)", () => {
    const koBonds = layout.bonds.filter(
      (b) => b.kind === "match" && b.stage !== "group",
    );
    // 5 synthesised knockout matches end up as match bonds (tp is omitted).
    expect(koBonds.length).toBeGreaterThanOrEqual(5);
    const finalBond = koBonds.find((b) => b.stage === "f");
    expect(finalBond).toBeDefined();
    expect(finalBond!.color).toBe(PALETTE.champion);
  });

  it("is deterministic — building twice yields identical layouts", () => {
    const a = buildMoleculeLayout(t, fakeCascaded);
    const b = buildMoleculeLayout(t, fakeCascaded);
    expect(a.nodes.length).toBe(b.nodes.length);
    for (let i = 0; i < a.nodes.length; i++) {
      expect(a.nodes[i]!.position).toEqual(b.nodes[i]!.position);
      expect(a.nodes[i]!.id).toBe(b.nodes[i]!.id);
    }
    expect(a.bonds.length).toBe(b.bonds.length);
  });

  it("signals hasAnyKnockoutPick = true", () => {
    expect(layout.hasAnyKnockoutPick).toBe(true);
  });
});

describe("stableHash01 — small util sanity", () => {
  it("returns a value in [0, 1] for every input", () => {
    for (const s of ["ARG", "FRA", "ENG", "BRA", "URU", "QAT", "USA", "MEX", ""]) {
      const u = stableHash01(s);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });
  it("is deterministic", () => {
    expect(stableHash01("ARG")).toBe(stableHash01("ARG"));
    expect(stableHash01("ARG")).not.toBe(stableHash01("BRA"));
  });
});

// Helper, kept here so the test file is self-contained.
function _unused(_b: Bracket) {
  return _b;
}
_unused(emptyBracket());
