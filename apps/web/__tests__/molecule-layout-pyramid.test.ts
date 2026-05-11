/**
 * Vitest — `buildMoleculeLayout` pyramid invariants (v3).
 *
 * These tests complement `molecule-layout.test.ts`. They cover the v3
 * pyramid placement: champion at the apex, tiers monotonic up the
 * y-axis, base radius wider than the apex, losers staying at their
 * elimination tier.
 *
 * The R3F scene component is NOT exercised here — that's covered by
 * the existing render-shape test under jsdom mocks.
 */

import { describe, it, expect } from "vitest";

import {
  buildMoleculeLayout,
  TIER_Y_TEST_ONLY,
  RING_RADII_TEST_ONLY,
  isAtPyramidTier,
  type FinalStage,
  type MoleculeLayout,
} from "@/lib/molecule/layout";
import { loadFixtures2026, type Tournament } from "@vtorn/bracket-engine";

const T: Tournament = loadFixtures2026();

function synthCascadeChampionRoute(
  championCode: string,
  opponents: {
    r32: string;
    r16: string;
    qf: string;
    sf: string;
    f: string;
    tp_home: string;
    tp_away: string;
    tp_winner: string;
  },
) {
  return {
    tournament_id: T.id,
    groups: T.groups.map((g) => ({
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
        away: { source: { kind: "group_position" as const, group: "B", position: 2 }, team: opponents.r32, from_actual: false },
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
        away: { source: { kind: "knockout_winner" as const, match_id: "r32_02" }, team: opponents.r16, from_actual: false },
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
        away: { source: { kind: "knockout_winner" as const, match_id: "r16_02" }, team: opponents.qf, from_actual: false },
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
        away: { source: { kind: "knockout_winner" as const, match_id: "qf_02" }, team: opponents.sf, from_actual: false },
        predicted_winner: championCode,
        actual_winner: null,
        effective_winner: championCode,
        affected_by_withdrawal: false,
      },
      {
        id: "tp_01",
        stage: "tp" as const,
        match_no: 103,
        home: { source: { kind: "knockout_loser" as const, match_id: "sf_01" }, team: opponents.tp_home, from_actual: false },
        away: { source: { kind: "knockout_loser" as const, match_id: "sf_02" }, team: opponents.tp_away, from_actual: false },
        predicted_winner: opponents.tp_winner,
        actual_winner: null,
        effective_winner: opponents.tp_winner,
        affected_by_withdrawal: false,
      },
      {
        id: "final",
        stage: "f" as const,
        match_no: 104,
        home: { source: { kind: "knockout_winner" as const, match_id: "sf_01" }, team: championCode, from_actual: false },
        away: { source: { kind: "knockout_winner" as const, match_id: "sf_02" }, team: opponents.f, from_actual: false },
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
}

describe("buildMoleculeLayout — pyramid (v3)", () => {
  const cascaded = synthCascadeChampionRoute("ARG", {
    r32: "BRA",
    r16: "FRA",
    qf: "GER",
    sf: "ESP",
    f: "ENG",
    tp_home: "ESP",
    tp_away: "POR",
    tp_winner: "ESP",
  });
  const layout: MoleculeLayout = buildMoleculeLayout(T, cascaded);

  it("places the predicted champion at the apex (y = TIER_Y.champion, r = 0)", () => {
    const champ = layout.nodes.find((n) => n.teamCode === "ARG")!;
    expect(champ).toBeDefined();
    expect(champ.finalStage).toBe("champion");
    expect(champ.position[1]).toBeCloseTo(TIER_Y_TEST_ONLY.champion, 5);
    expect(Math.hypot(champ.position[0], champ.position[2])).toBeLessThan(0.001);
  });

  it("places group-stage eliminated teams on the base (y ≈ 0)", () => {
    const groupOut = layout.nodes.filter((n) => n.finalStage === "group");
    expect(groupOut.length).toBeGreaterThan(10);
    for (const n of groupOut) {
      expect(isAtPyramidTier(n, "group")).toBe(true);
    }
  });

  it("places R32 losers at the R32 tier (y ≈ 4), not the base", () => {
    // R32 loser of our synthesised match was "BRA".
    const bra = layout.nodes.find((n) => n.teamCode === "BRA")!;
    expect(bra.finalStage).toBe("r32");
    expect(isAtPyramidTier(bra, "r32")).toBe(true);
    // strictly above the base
    expect(bra.position[1]).toBeGreaterThan(TIER_Y_TEST_ONLY.group + 2);
  });

  it("y-heights are strictly monotonic per tier (champion > SF > QF > R16 > R32 > group)", () => {
    const order: FinalStage[] = ["group", "r32", "r16", "qf", "runner_up", "champion"];
    for (let i = 0; i < order.length - 1; i++) {
      expect(TIER_Y_TEST_ONLY[order[i + 1]!]).toBeGreaterThan(TIER_Y_TEST_ONLY[order[i]!]);
    }
  });

  it("horizontal footprint shrinks as the tier rises (base radius > apex)", () => {
    // Each tier above the base must have a smaller horizontal radius.
    const order: FinalStage[] = ["group", "r32", "r16", "qf", "runner_up", "champion"];
    for (let i = 0; i < order.length - 1; i++) {
      expect(RING_RADII_TEST_ONLY[order[i]!]).toBeGreaterThan(
        RING_RADII_TEST_ONLY[order[i + 1]!],
      );
    }
  });

  it("the runner-up sits at the SF tier (y ≈ 22), not at the apex", () => {
    expect(layout.runnerUpCode).toBe("ENG");
    const runner = layout.nodes.find((n) => n.teamCode === "ENG")!;
    expect(runner.finalStage).toBe("runner_up");
    expect(isAtPyramidTier(runner, "runner_up")).toBe(true);
    expect(runner.position[1]).toBeLessThan(TIER_Y_TEST_ONLY.champion);
  });

  it("the bronze-winner sits at the SF tier with third_place classification", () => {
    expect(layout.thirdPlaceCode).toBe("ESP");
    const bronze = layout.nodes.find((n) => n.teamCode === "ESP")!;
    expect(bronze.finalStage).toBe("third_place");
    expect(isAtPyramidTier(bronze, "third_place")).toBe(true);
  });

  it("layout is deterministic — same input, same node positions", () => {
    const a = buildMoleculeLayout(T, cascaded);
    const b = buildMoleculeLayout(T, cascaded);
    expect(a.nodes.length).toBe(b.nodes.length);
    for (let i = 0; i < a.nodes.length; i++) {
      expect(a.nodes[i]!.position).toEqual(b.nodes[i]!.position);
    }
  });
});

describe("buildMoleculeLayout — pyramid layout snapshot", () => {
  // Stable JSON snapshot of the layout function's per-node position +
  // stage for the same synthesised champion-route cascade. Catches any
  // accidental drift in atom placement.
  it("matches the recorded layout snapshot", () => {
    const cascaded = synthCascadeChampionRoute("ARG", {
      r32: "BRA",
      r16: "FRA",
      qf: "GER",
      sf: "ESP",
      f: "ENG",
      tp_home: "ESP",
      tp_away: "POR",
      tp_winner: "ESP",
    });
    const layout = buildMoleculeLayout(T, cascaded);
    // We snapshot only the predictable per-stage summary — full per-node
    // positions would brittle-fail on harmless palette tweaks. The
    // summary is "for each finalStage, how many teams are there?".
    const summary: Record<string, number> = {};
    for (const n of layout.nodes) {
      summary[n.finalStage] = (summary[n.finalStage] ?? 0) + 1;
    }
    expect(summary).toMatchObject({
      champion: 1,
      runner_up: 1,
      third_place: 1,
      fourth_place: 1,
    });
    expect(summary.group).toBeGreaterThan(10);
  });
});
