/**
 * Vitest, `buildMoleculeLayout` v4 full-bracket node count.
 *
 * Builds a fully-resolved CascadedBracket for a 48-team WC where the
 * R32-home team wins every match. Result: each layer is fully populated.
 *
 *   group: 48, r32: 32, r16: 16, qf: 8, sf: 4, f: 2, champion: 1 → 111.
 *
 * Also asserts that the champion has 7 instances and the runner-up has 6.
 */

import { describe, it, expect } from "vitest";

import {
  buildMoleculeLayout,
  instancesOf,
  type MoleculeLayout,
} from "@/lib/molecule/layout";
import {
  loadFixtures2026,
  type CascadedBracket,
  type CascadedKnockout,
  type Tournament,
} from "@vtorn/bracket-engine";

/**
 * Build a fully-resolved cascade by walking the tournament's knockout
 * list in match-order, picking the *home* slot of each upstream as the
 * winner. r32 home slots come from group-position sources (1st/2nd of
 * group A/B/...), so we use deterministic group-finishing-orders.
 */
function fullyResolvedCascade(t: Tournament): CascadedBracket {
  // 1. Each group's effective_order = its team_ids in declared order.
  const groups = t.groups.map((g) => ({
    group_id: g.id,
    predicted_order: [...g.team_ids],
    actual_order: null,
    effective_order: [...g.team_ids],
    settled: false,
  }));

  /** Look up the team for a SlotSource against the current cascade state. */
  const teamByGroupPos = (group: string, position: number): string | null => {
    const g = groups.find((x) => x.group_id === group);
    if (!g) return null;
    // position is 1-indexed.
    return g.effective_order[position - 1] ?? null;
  };
  // Pre-build the "best thirds" pool: 12 groups × 3rd-placed teams,
  // ranked by group letter (stable). The cascade engine's actual logic
  // uses points + GD; for this test we only need 8 *distinct* teams.
  const bestThirdsPool: string[] = (() => {
    const out: string[] = [];
    for (const g of groups) {
      const third = g.effective_order[2];
      if (third) out.push(third);
    }
    return out;
  })();

  const teamForBestThird = (rank: number, eligible: readonly string[]): string | null => {
    // 1-indexed rank within the eligible-groups slice of the pool.
    const filtered = bestThirdsPool.filter((t) => {
      const grp = groups.find((g) => g.effective_order.includes(t));
      return grp ? eligible.includes(grp.group_id) : false;
    });
    return filtered[rank - 1] ?? null;
  };

  const cascadedKnockouts: CascadedKnockout[] = [];
  // We need to resolve in stage order so knockout_winner sources are
  // valid by the time the next stage references them.
  const stageOrder = ["r32", "r16", "qf", "sf", "tp", "f"] as const;
  const fixturesByStage = (s: string) =>
    t.knockouts.filter((k) => k.stage === s);

  function resolveSource(
    src: import("@vtorn/bracket-engine").SlotSource,
  ): string | null {
    if (src.kind === "group_position") {
      return teamByGroupPos(src.group, src.position);
    }
    if (src.kind === "best_third") {
      return teamForBestThird(src.rank, src.eligible_groups);
    }
    if (src.kind === "best_fourth") {
      return null; // not used by WC 2026 fixtures
    }
    if (src.kind === "knockout_winner") {
      const k = cascadedKnockouts.find((x) => x.id === src.match_id);
      return k?.effective_winner ?? null;
    }
    if (src.kind === "knockout_loser") {
      const k = cascadedKnockouts.find((x) => x.id === src.match_id);
      if (!k) return null;
      // loser is the side of the match whose team isn't the winner.
      const winner = k.effective_winner;
      if (!winner) return null;
      if (k.home.team && k.home.team !== winner) return k.home.team;
      if (k.away.team && k.away.team !== winner) return k.away.team;
      return null;
    }
    return null;
  }

  for (const stage of stageOrder) {
    for (const fx of fixturesByStage(stage)) {
      const homeTeam = resolveSource(fx.home);
      const awayTeam = resolveSource(fx.away);
      const winner = homeTeam ?? awayTeam ?? null;
      const k: CascadedKnockout = {
        id: fx.id,
        stage: fx.stage,
        match_no: fx.match_no,
        home: { source: fx.home, team: homeTeam, from_actual: false },
        away: { source: fx.away, team: awayTeam, from_actual: false },
        predicted_winner: winner,
        actual_winner: null,
        effective_winner: winner,
        affected_by_withdrawal: false,
      };
      cascadedKnockouts.push(k);
    }
  }

  return {
    tournament_id: t.id,
    groups,
    knockouts: cascadedKnockouts,
    locked_keys: [],
    committed_teams: [],
    committed_total_required: 0,
    warnings: [],
  };
}

describe("buildMoleculeLayout, v4 fully-resolved 48-team WC", () => {
  const t = loadFixtures2026();
  const cascade = fullyResolvedCascade(t);
  const layout: MoleculeLayout = buildMoleculeLayout(t, cascade);

  it("identifies a champion", () => {
    expect(layout.championCode).not.toBeNull();
  });

  it("emits exactly 111 nodes (48 + 32 + 16 + 8 + 4 + 2 + 1)", () => {
    expect(layout.nodes.length).toBe(48 + 32 + 16 + 8 + 4 + 2 + 1);
  });

  it("matches the canonical per-layer counts", () => {
    const counts: Record<string, number> = {};
    for (const n of layout.nodes) {
      counts[n.stage] = (counts[n.stage] ?? 0) + 1;
    }
    expect(counts).toEqual({
      group: 48,
      r32: 32,
      r16: 16,
      qf: 8,
      sf: 4,
      f: 2,
      champion: 1,
    });
  });

  it("champion has exactly 7 instances", () => {
    const champ = layout.championCode!;
    expect(instancesOf(layout.nodes, champ).length).toBe(7);
  });

  it("runner-up has exactly 6 instances", () => {
    const runnerUp = layout.runnerUpCode!;
    expect(instancesOf(layout.nodes, runnerUp).length).toBe(6);
  });

  it("emits 31 match bonds in the knockout layers + 72 in the group + tp omitted", () => {
    const matchBonds = layout.bonds.filter((b) => b.kind === "match");
    const groupBonds = matchBonds.filter((b) => b.stage === "group");
    const koBonds = matchBonds.filter((b) => b.stage !== "group");
    // FIFA WC 2026: 12 groups × 6 fixtures = 72 group matches.
    expect(groupBonds.length).toBe(72);
    // r32 + r16 + qf + sf + f = 16 + 8 + 4 + 2 + 1 = 31. (tp is skipped.)
    expect(koBonds.length).toBe(31);
  });

  it("emits 6 advance bonds for the champion (group→r32→…→champion)", () => {
    const champ = layout.championCode!;
    const advance = layout.bonds.filter(
      (b) => b.kind === "advance" && b.a === champ,
    );
    expect(advance.length).toBe(6);
  });

  it("total advance bonds = 63 (sum of layer-occupancy steps)", () => {
    // Advance bonds count = sum over all teams of (deepest-layer-index).
    // 48 teams reach group (no advance bond yet, every team is at layer 0).
    // 32 teams cross from group → r32 (32 advance bonds).
    // 16 cross r32 → r16, 8 cross r16 → qf, 4 cross qf → sf,
    // 2 cross sf → f, 1 crosses f → champion.
    // Total = 32 + 16 + 8 + 4 + 2 + 1 = 63.
    const advance = layout.bonds.filter((b) => b.kind === "advance");
    expect(advance.length).toBe(63);
  });
});
