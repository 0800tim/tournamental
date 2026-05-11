/**
 * Vitest, molecule v5.1 opponent-label primitives.
 *
 * Tim 2026-05-11: "Molecule paths still aren't perfect. As you go up
 * each stage of the tournament, it should say and be connected to the
 * team that you are playing, but it doesn't seem to be clearly doing
 * that in this view. For example, I can't see where they're facing
 * England clearly."
 *
 * v5.1 adds three primitives the MoleculeScene renderer consumes so
 * each gold-path match-bond can render a prominent "STAGE vs <FLAG>
 * <NAME>" pill and each opponent atom can light up with a silver "VS"
 * chip:
 *
 *   1. For every match-bond on the active path, the OPPONENT of the
 *      path team is derivable from the bond's (a, b) endpoints, the
 *      one that ISN'T the path team's code. The molecule scene builds
 *      this lookup in-component (no library helper required); the
 *      invariant under test here is on the underlying TeamPath shape.
 *   2. The set of opponent codes on a path equals atomCodes minus the
 *      path team's own code. The scene uses this set to drive the
 *      silver "VS" rim ring on opponent atoms.
 *   3. The opponent code at each stage is stable across every layer
 *      that the path team reached, exactly one opponent per stage,
 *      never a gap or a duplicate.
 */

import { describe, it, expect } from "vitest";

import { derivePathToGold } from "@/lib/molecule/path";
import type { CascadedBracket } from "@vtorn/bracket-engine";

/**
 * Synthetic full ARG → BRA → FRA → GER → ESP → ENG champion run.
 * Mirrors the cascade in molecule-path.test.ts so the two suites lean
 * on the same fixture shape.
 */
function fullARGChampionCascade(): CascadedBracket {
  return {
    tournament_id: "t",
    groups: [],
    knockouts: [
      {
        id: "r32_01",
        stage: "r32",
        match_no: 73,
        home: { source: { kind: "group_position", group: "A", position: 1 }, team: "ARG", from_actual: false },
        away: { source: { kind: "group_position", group: "B", position: 2 }, team: "BRA", from_actual: false },
        predicted_winner: "ARG",
        actual_winner: null,
        effective_winner: "ARG",
        affected_by_withdrawal: false,
      },
      {
        id: "r16_01",
        stage: "r16",
        match_no: 90,
        home: { source: { kind: "knockout_winner", match_id: "r32_01" }, team: "ARG", from_actual: false },
        away: { source: { kind: "knockout_winner", match_id: "r32_02" }, team: "FRA", from_actual: false },
        predicted_winner: "ARG",
        actual_winner: null,
        effective_winner: "ARG",
        affected_by_withdrawal: false,
      },
      {
        id: "qf_01",
        stage: "qf",
        match_no: 98,
        home: { source: { kind: "knockout_winner", match_id: "r16_01" }, team: "ARG", from_actual: false },
        away: { source: { kind: "knockout_winner", match_id: "r16_02" }, team: "GER", from_actual: false },
        predicted_winner: "ARG",
        actual_winner: null,
        effective_winner: "ARG",
        affected_by_withdrawal: false,
      },
      {
        id: "sf_01",
        stage: "sf",
        match_no: 102,
        home: { source: { kind: "knockout_winner", match_id: "qf_01" }, team: "ARG", from_actual: false },
        away: { source: { kind: "knockout_winner", match_id: "qf_02" }, team: "ESP", from_actual: false },
        predicted_winner: "ARG",
        actual_winner: null,
        effective_winner: "ARG",
        affected_by_withdrawal: false,
      },
      {
        id: "final",
        stage: "f",
        match_no: 104,
        home: { source: { kind: "knockout_winner", match_id: "sf_01" }, team: "ARG", from_actual: false },
        away: { source: { kind: "knockout_winner", match_id: "sf_02" }, team: "ENG", from_actual: false },
        predicted_winner: "ARG",
        actual_winner: null,
        effective_winner: "ARG",
        affected_by_withdrawal: false,
      },
    ],
    locked_keys: [],
    committed_teams: [],
    committed_total_required: 0,
    warnings: [],
  };
}

/**
 * Replicates the in-component lookup the MoleculeScene builds for the
 * "STAGE vs <NAME>" badge. Kept inline (no library export) because the
 * scene is the only consumer.
 */
function opponentByMatchBondKey(
  path: ReturnType<typeof derivePathToGold>,
): Map<string, string> {
  const out = new Map<string, string>();
  const tc = path.teamCode;
  if (!tc) return out;
  for (const b of path.bonds) {
    const opp = b.a === tc ? b.b : b.a;
    out.set(`${b.stage}:${b.a}:${b.b}`, opp);
  }
  return out;
}

describe("v5.1, opponent code per match-bond on the active path", () => {
  const cascade = fullARGChampionCascade();
  const path = derivePathToGold(cascade, "ARG");

  it("maps each path match-bond to the OPPONENT of the path team", () => {
    const opps = opponentByMatchBondKey(path);
    expect(opps.get("r32:ARG:BRA")).toBe("BRA");
    expect(opps.get("r16:ARG:FRA")).toBe("FRA");
    expect(opps.get("qf:ARG:GER")).toBe("GER");
    expect(opps.get("sf:ARG:ESP")).toBe("ESP");
    expect(opps.get("f:ARG:ENG")).toBe("ENG");
  });

  it("the opponent is never the path team itself", () => {
    const opps = opponentByMatchBondKey(path);
    for (const opp of opps.values()) {
      expect(opp).not.toBe("ARG");
    }
  });

  it("there is exactly one opponent per stage on a full champion path", () => {
    const opps = opponentByMatchBondKey(path);
    const stagesSeen = new Set<string>();
    for (const key of opps.keys()) {
      const stage = key.split(":")[0]!;
      expect(stagesSeen.has(stage)).toBe(false);
      stagesSeen.add(stage);
    }
    expect(stagesSeen.size).toBe(5);
  });

  it("works for the runner-up's path (final-only)", () => {
    const eng = derivePathToGold(cascade, "ENG");
    const opps = opponentByMatchBondKey(eng);
    expect(opps.get("f:ARG:ENG")).toBe("ARG");
  });

  it("empty cascade / nullish team yields an empty opponent map", () => {
    const empty = derivePathToGold(null, null);
    expect(opponentByMatchBondKey(empty).size).toBe(0);
    const nope = derivePathToGold(cascade, "");
    expect(opponentByMatchBondKey(nope).size).toBe(0);
  });
});

describe("v5.1, opponent atom set (silver rim ring driver)", () => {
  const cascade = fullARGChampionCascade();
  const path = derivePathToGold(cascade, "ARG");

  it("opponent atoms = path.atomCodes minus the path team's own code", () => {
    const opps = new Set(path.atomCodes.filter((c) => c !== path.teamCode));
    expect(opps.has("BRA")).toBe(true);
    expect(opps.has("FRA")).toBe(true);
    expect(opps.has("GER")).toBe(true);
    expect(opps.has("ESP")).toBe(true);
    expect(opps.has("ENG")).toBe(true);
    expect(opps.has("ARG")).toBe(false);
  });

  it("there is exactly one opponent per surviving stage (no doubles)", () => {
    const opps = path.atomCodes.filter((c) => c !== path.teamCode);
    expect(new Set(opps).size).toBe(opps.length);
    expect(opps.length).toBe(5);
  });
});
