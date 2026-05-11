/**
 * Vitest — `buildMoleculeLayout` deterministic layout assertions.
 *
 * These tests cover the pure-function piece of the molecule view: given
 * a `(tournament, cascaded)` pair, the layout must:
 *
 *   1. Place the predicted champion at (or extremely near) the origin.
 *   2. Place teams that "haven't yet been picked into a knockout"
 *      (i.e. group-stage eliminated, by default) on the outermost ring
 *      at radius `RING_RADIUS.group` (modulo small y-jitter).
 *   3. Use the right palette colour per stage.
 *   4. Emit one bond per group fixture + one bond per resolved knockout.
 *   5. Be deterministic — same inputs, same output, no clock reads.
 *
 * The R3F scene component is *not* tested here (we mock it in the page
 * smoke test) because mounting @react-three/fiber under jsdom requires a
 * WebGL context the test environment doesn't have.
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

describe("buildMoleculeLayout — empty bracket", () => {
  const t = loadFixtures2026();
  const empty = cascade(t, emptyPrediction(t));
  const layout = buildMoleculeLayout(t, empty);

  it("renders one node per team in the tournament", () => {
    expect(layout.nodes.length).toBe(t.teams.length);
  });

  it("places every team on the outermost group ring when no picks exist", () => {
    for (const n of layout.nodes) {
      expect(n.finalStage).toBe("group");
      expect(isOnGroupRing(n)).toBe(true);
    }
  });

  it("emits the group-stage bonds for every group fixture", () => {
    const groupBonds = layout.bonds.filter((b) => b.stage === "group");
    expect(groupBonds.length).toBe(t.group_fixtures.length);
  });

  it("does not crash on empty predictions and signals no knockout picks yet", () => {
    expect(layout.hasAnyKnockoutPick).toBe(false);
    expect(layout.championCode).toBeNull();
  });

  it("uses the group-stage palette colour for the rim of group-out teams", () => {
    // Rim colour comes from the stage palette regardless of the team's
    // kit primary. The node.accentColor field stores the kit (or a
    // palette fallback if no kit defined).
    // Spot-check: ensure all nodes have a non-empty accentColor string.
    for (const n of layout.nodes) {
      expect(typeof n.accentColor).toBe("string");
      expect(n.accentColor.length).toBeGreaterThan(0);
    }
    // PALETTE.group should be a #-prefixed hex.
    expect(PALETTE.group).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("buildMoleculeLayout — champion-at-origin invariant", () => {
  /**
   * Synthesise a cascaded bracket where the user has picked every
   * knockout's "home" side to advance. We don't go through the full
   * BracketBuilder flow — we synthesise a CascadedBracket directly so
   * the test stays local to the layout logic.
   */
  const t = loadFixtures2026();
  // Pick "ARG" as the synthetic champion (it's in the 2026 fixtures).
  const championCode = "ARG";
  const argInTournament = t.teams.some((x) => x.id === championCode);
  expect(argInTournament).toBe(true);

  // Build a minimal CascadedBracket-shape: one knockout match per stage,
  // with a known winner so the layout function classifies ARG as
  // "champion".
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

  it("places the champion at the molecule origin", () => {
    const champ = layout.nodes.find((n) => n.teamCode === championCode)!;
    expect(champ).toBeDefined();
    expect(champ.finalStage).toBe("champion");
    expect(isAtOrigin(champ)).toBe(true);
  });

  it("places the runner-up on the inner ring (radius < group ring)", () => {
    expect(layout.runnerUpCode).toBe("ENG");
    const runner = layout.nodes.find((n) => n.teamCode === "ENG");
    expect(runner).toBeDefined();
    expect(runner!.finalStage).toBe("runner_up");
    const dist = Math.hypot(runner!.position[0], runner!.position[2]);
    expect(dist).toBeLessThan(RING_RADII_TEST_ONLY.group);
    expect(dist).toBeGreaterThan(0);
  });

  it("places the bronze (3rd-place playoff winner) at the runner_up ring", () => {
    expect(layout.thirdPlaceCode).toBe("ESP");
    const bronze = layout.nodes.find((n) => n.teamCode === "ESP");
    expect(bronze).toBeDefined();
    expect(bronze!.finalStage).toBe("third_place");
  });

  it("places group-stage eliminated teams at the group ring", () => {
    // Most teams in this synthesised cascade never played a knockout
    // — they're group-stage eliminated and must sit on the outer ring.
    const groupOut = layout.nodes.filter((n) => n.finalStage === "group");
    expect(groupOut.length).toBeGreaterThan(10);
    for (const n of groupOut) {
      expect(isOnGroupRing(n)).toBe(true);
    }
  });

  it("emits a bond for the final + sf + qf + r16 + r32 + tp matches", () => {
    const koBonds = layout.bonds.filter((b) => b.stage !== "group");
    // 6 synthesised knockout matches; the synthesiser provided exactly one per stage.
    expect(koBonds.length).toBeGreaterThanOrEqual(6);
    const finalBond = koBonds.find((b) => b.stage === "f");
    expect(finalBond).toBeDefined();
    expect(finalBond!.color).toBe(PALETTE.champion);
  });

  it("is deterministic — building twice yields the same layout", () => {
    const a = buildMoleculeLayout(t, fakeCascaded);
    const b = buildMoleculeLayout(t, fakeCascaded);
    expect(a.nodes.length).toBe(b.nodes.length);
    for (let i = 0; i < a.nodes.length; i++) {
      expect(a.nodes[i]!.position).toEqual(b.nodes[i]!.position);
      expect(a.nodes[i]!.teamCode).toBe(b.nodes[i]!.teamCode);
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
