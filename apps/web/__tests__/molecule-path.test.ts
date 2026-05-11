/**
 * Vitest, `derivePathToGold` champion-path derivation.
 *
 * The molecule v2 view highlights the predicted champion's road to the
 * final in gold. This test suite covers the derivation function:
 *
 *   1. Given a fully-resolved bracket with a champion, the derivation
 *      returns exactly 5 bonds in R32→R16→QF→SF→F order.
 *   2. Given a bracket with no resolved R32 slot for the champion, the
 *      derivation falls back gracefully to an empty path.
 *   3. The 3rd-place playoff bond is excluded from the path (the gold
 *      trail is to the trophy, not to bronze).
 *   4. atomCodes contains the team + every opponent encountered.
 *   5. Bond keys round-trip through `buildPathBondKeySet` for fast lookup.
 */

import { describe, it, expect } from "vitest";

import {
  derivePathToGold,
  buildPathBondKeySet,
  buildPathAtomSet,
} from "@/lib/molecule/path";
import type { CascadedBracket } from "@vtorn/bracket-engine";

/**
 * Helper, build a fully-resolved synthetic cascade where ARG beats
 * BRA (R32) → FRA (R16) → GER (QF) → ESP (SF) → ENG (F), and ESP wins
 * the 3rd-place playoff over POR.
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
        id: "tp_01",
        stage: "tp",
        match_no: 103,
        home: { source: { kind: "knockout_loser", match_id: "sf_01" }, team: "ESP", from_actual: false },
        away: { source: { kind: "knockout_loser", match_id: "sf_02" }, team: "POR", from_actual: false },
        predicted_winner: "ESP",
        actual_winner: null,
        effective_winner: "ESP",
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

describe("derivePathToGold, full champion cascade", () => {
  const cascade = fullARGChampionCascade();

  it("returns exactly 5 bonds for the champion's road to the final", () => {
    const path = derivePathToGold(cascade, "ARG");
    expect(path.bonds.length).toBe(5);
  });

  it("orders bonds R32 → R16 → QF → SF → F", () => {
    const path = derivePathToGold(cascade, "ARG");
    expect(path.bonds.map((b) => b.stage)).toEqual(["r32", "r16", "qf", "sf", "f"]);
  });

  it("excludes the 3rd-place playoff bond from the path-to-gold", () => {
    const path = derivePathToGold(cascade, "ARG");
    expect(path.bonds.find((b) => b.stage === "tp")).toBeUndefined();
  });

  it("collects every opponent into atomCodes alongside the team", () => {
    const path = derivePathToGold(cascade, "ARG");
    const set = buildPathAtomSet(path);
    expect(set.has("ARG")).toBe(true);
    expect(set.has("BRA")).toBe(true);
    expect(set.has("FRA")).toBe(true);
    expect(set.has("GER")).toBe(true);
    expect(set.has("ESP")).toBe(true);
    expect(set.has("ENG")).toBe(true);
    // 3rd-place playoff opponents that ARG didn't play should NOT be in.
    expect(set.has("POR")).toBe(false);
  });

  it("flags reachesFinal=true and winsFinal=true for the champion", () => {
    const path = derivePathToGold(cascade, "ARG");
    expect(path.reachesFinal).toBe(true);
    expect(path.winsFinal).toBe(true);
  });

  it("flags reachesFinal=true and winsFinal=false for the runner-up", () => {
    const path = derivePathToGold(cascade, "ENG");
    expect(path.reachesFinal).toBe(true);
    expect(path.winsFinal).toBe(false);
  });

  it("bond key set has the right size + keys are lexically sorted", () => {
    const path = derivePathToGold(cascade, "ARG");
    const keys = buildPathBondKeySet(path);
    expect(keys.size).toBe(5);
    // ARG vs BRA → lexical order is ARG, BRA → key "r32:ARG:BRA"
    expect(keys.has("r32:ARG:BRA")).toBe(true);
    // ARG vs ENG (final): lexical order is ARG, ENG → "f:ARG:ENG"
    expect(keys.has("f:ARG:ENG")).toBe(true);
  });
});

describe("derivePathToGold, partial / empty / fallback inputs", () => {
  it("returns an empty path when the cascaded bracket is null", () => {
    const path = derivePathToGold(null, "ARG");
    expect(path.bonds).toEqual([]);
    expect(path.atomCodes).toEqual([]);
    expect(path.reachesFinal).toBe(false);
    expect(path.winsFinal).toBe(false);
  });

  it("returns an empty path when the team code is null/undefined/empty", () => {
    const cascade = fullARGChampionCascade();
    for (const code of [null, undefined, ""] as const) {
      const path = derivePathToGold(cascade, code);
      expect(path.bonds).toEqual([]);
    }
  });

  it("falls back to empty when the champion has no resolved R32 opponent yet", () => {
    // Synthetic cascade where ARG's R32 slot is resolved on the home side
    // only, the away side hasn't been picked yet. This is the typical
    // mid-edit state.
    const cascade: CascadedBracket = {
      tournament_id: "t",
      groups: [],
      knockouts: [
        {
          id: "r32_01",
          stage: "r32",
          match_no: 73,
          home: { source: { kind: "group_position", group: "A", position: 1 }, team: "ARG", from_actual: false },
          away: { source: { kind: "group_position", group: "B", position: 2 }, team: null, from_actual: false },
          predicted_winner: null,
          actual_winner: null,
          effective_winner: null,
          affected_by_withdrawal: false,
        },
      ],
      locked_keys: [],
      committed_teams: [],
      committed_total_required: 0,
      warnings: [],
    };
    const path = derivePathToGold(cascade, "ARG");
    expect(path.bonds).toEqual([]);
    expect(path.reachesFinal).toBe(false);
  });

  it("falls back to empty when the team doesn't appear in any knockout match", () => {
    const cascade = fullARGChampionCascade();
    // "MEX" was never placed into a knockout slot in our synthetic cascade.
    const path = derivePathToGold(cascade, "MEX");
    expect(path.bonds).toEqual([]);
    expect(path.reachesFinal).toBe(false);
  });

  it("group-stage bonds are never included in the path", () => {
    const cascade = fullARGChampionCascade();
    const path = derivePathToGold(cascade, "ARG");
    for (const b of path.bonds) {
      expect(b.stage).not.toBe("group");
    }
  });
});

describe("derivePathToGold, semi-finalist who lost", () => {
  // ESP played the SF (lost to ARG) and the tp match (won). Their
  // path-to-gold should be R32 → R16 → QF → SF (no F).
  const cascade = fullARGChampionCascade();

  it("includes SF but not the tp match (consolation branch)", () => {
    // For ESP we'd need their full prior path too; the synthetic cascade
    // only sets ESP into the SF onwards. The derivation should still
    // return the SF + tp filtered out. tp is filtered.
    const path = derivePathToGold(cascade, "ESP");
    // ESP appears in sf_01 (lost) and tp_01 (won). Only sf survives.
    expect(path.bonds.map((b) => b.stage)).toEqual(["sf"]);
    expect(path.reachesFinal).toBe(false);
    expect(path.winsFinal).toBe(false);
  });
});
