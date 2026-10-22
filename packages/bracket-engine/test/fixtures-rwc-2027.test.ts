/**
 * The vendored Men's Rugby World Cup 2027 fixtures: shape, pool
 * coverage, knockout graph, the round of 16 permutation table and a
 * full cascade from pool picks to the final with four best thirds.
 */

import { describe, expect, it } from "vitest";

import { cascade } from "../src/cascade.js";
import { loadFixtures, loadFixtures2026, loadFixturesRwc2027, VENDORED_TOURNAMENT_IDS } from "../src/fixtures-loader.js";
import { RUGBY_UNION_STANDINGS_RULES, standingsRulesFor } from "../src/standings.js";
import type { BracketPrediction, KnockoutFixture, SlotSource } from "../src/tournament.js";

const t = loadFixturesRwc2027();

describe("rwc-2027 fixtures: shape", () => {
  it("loads by id and by name", () => {
    expect(t.id).toBe("rwc-2027");
    expect(t.sport).toBe("rugby_union");
    expect(loadFixtures("rwc-2027").id).toBe("rwc-2027");
    expect(loadFixtures("fifa-wc-2026").id).toBe(loadFixtures2026().id);
    expect(VENDORED_TOURNAMENT_IDS).toEqual(["fifa-wc-2026", "rwc-2027"]);
    expect(() => loadFixtures("nope" as never)).toThrow(/no vendored fixtures/);
    expect(standingsRulesFor(t)).toBe(RUGBY_UNION_STANDINGS_RULES);
  });

  it("has 24 distinct teams in six pools of four, each team in exactly one pool", () => {
    expect(t.teams).toHaveLength(24);
    expect(new Set(t.teams.map((x) => x.id)).size).toBe(24);
    expect(t.groups.map((g) => g.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    const seen = new Set<string>();
    for (const g of t.groups) {
      expect(g.team_ids).toHaveLength(4);
      for (const id of g.team_ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
        expect(t.teams.some((x) => x.id === id)).toBe(true);
      }
    }
    expect(seen.size).toBe(24);
    for (const team of t.teams) {
      expect(team.world_rank).toBeGreaterThanOrEqual(1);
      expect(team.world_rank).toBeLessThanOrEqual(24);
      expect(team.ranked_at).toBe("2025-12-01");
      expect(team.placeholder).toBe(false);
    }
    expect(new Set(t.teams.map((x) => x.world_rank)).size).toBe(24);
  });

  it("has 36 pool matches, every pair once, numbered in kickoff order", () => {
    expect(t.group_fixtures).toHaveLength(36);
    for (const g of t.groups) {
      const fx = t.group_fixtures.filter((f) => f.group_id === g.id);
      expect(fx).toHaveLength(6);
      const pairs = new Set(fx.map((f) => [f.home_idx, f.away_idx].sort().join("-")));
      expect(pairs.size).toBe(6);
      for (const f of fx) {
        expect(f.home_idx).not.toBe(f.away_idx);
        expect(f.host).toBe("AU");
        expect(f.kickoff_utc).toMatch(/^2027-10-\d\dT\d\d:\d\d:00Z$/);
      }
    }
    const nos = t.group_fixtures.map((f) => f.match_no);
    expect(nos).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
    for (let i = 1; i < t.group_fixtures.length; i++) {
      expect(t.group_fixtures[i]!.kickoff_utc >= t.group_fixtures[i - 1]!.kickoff_utc).toBe(true);
    }
    expect(t.start_utc).toBe(t.group_fixtures[0]!.kickoff_utc);
  });

  it("opens with the hosts in Perth and closes with the final in Sydney", () => {
    const first = t.group_fixtures[0]!;
    const poolA = t.groups[0]!;
    expect(poolA.team_ids[first.home_idx]).toBe("AUS");
    expect(first.kickoff_utc).toBe("2027-10-01T10:45:00Z"); // 18:45 AWST
    expect(first.venue).toMatch(/Perth/);
    const final = t.knockouts.find((k) => k.stage === "f")!;
    expect(final.id).toBe("final");
    expect(final.kickoff_utc).toBe("2027-11-13T09:00:00Z"); // 20:00 AEDT
    expect(t.final_utc).toBe(final.kickoff_utc);
  });

  it("has 16 knockouts whose slots all resolve to earlier fixtures", () => {
    const byStage = (s: KnockoutFixture["stage"]) => t.knockouts.filter((k) => k.stage === s);
    expect(byStage("r16")).toHaveLength(8);
    expect(byStage("qf")).toHaveLength(4);
    expect(byStage("sf")).toHaveLength(2);
    expect(byStage("tp")).toHaveLength(1);
    expect(byStage("f")).toHaveLength(1);
    expect(t.knockouts.map((k) => k.match_no)).toEqual(Array.from({ length: 16 }, (_, i) => 37 + i));
    const ids = new Map(t.knockouts.map((k) => [k.id, k]));
    const check = (k: KnockoutFixture, s: SlotSource) => {
      switch (s.kind) {
        case "knockout_winner":
        case "knockout_loser": {
          const up = ids.get(s.match_id);
          expect(up, `${k.id} references ${s.match_id}`).toBeDefined();
          expect(up!.kickoff_utc < k.kickoff_utc).toBe(true);
          return;
        }
        case "group_position":
          expect(t.groups.some((g) => g.id === s.group)).toBe(true);
          expect(s.position).toBeLessThanOrEqual(2);
          return;
        case "annex_c_third":
          expect(["A", "B", "C", "D"]).toContain(s.group_winner);
          return;
        default:
          throw new Error(`unexpected slot kind ${s.kind} on ${k.id}`);
      }
    };
    for (const k of t.knockouts) {
      check(k, k.home);
      check(k, k.away);
    }
    expect(t.advancement).toEqual({ automatic_per_group: 2, wildcard_third: 4, wildcard_fourth: 0 });
  });

  it("carries the published round of 16 permutation table for every set of four pools", () => {
    const table = t.annex_c_assignments!;
    const pools = ["A", "B", "C", "D", "E", "F"];
    const combos: string[] = [];
    for (let a = 0; a < 6; a++)
      for (let b = a + 1; b < 6; b++)
        for (let c = b + 1; c < 6; c++)
          for (let d = c + 1; d < 6; d++) combos.push([pools[a], pools[b], pools[c], pools[d]].join(","));
    expect(Object.keys(table).sort()).toEqual(combos);
    const allowed: Record<string, string[]> = { "1A": ["C", "E", "F"], "1B": ["D", "E", "F"], "1C": ["A", "E", "F"], "1D": ["B", "E", "F"] };
    for (const [key, row] of Object.entries(table)) {
      expect(Object.keys(row).sort()).toEqual(["1A", "1B", "1C", "1D"]);
      for (const [winner, third] of Object.entries(row)) expect(allowed[winner]).toContain(third);
      expect(Object.values(row).sort().join(",")).toBe(key);
    }
  });
});

describe("rwc-2027 fixtures: cascade", () => {
  function picks(thirdsFrom: readonly string[]): BracketPrediction {
    return {
      tournament_id: t.id,
      user_id: "u_test",
      groups: t.groups.map((g) => ({ group_id: g.id, order: [...g.team_ids] })),
      best_thirds: thirdsFrom.map((g) => t.groups.find((x) => x.id === g)!.team_ids[2]!),
      best_fourths: [],
      knockouts: [],
      locks: [],
      updated_at_utc: "2027-09-01T00:00:00Z",
    };
  }

  it("routes four best thirds into the round of 16 by the permutation table", () => {
    const c = cascade(t, picks(["A", "B", "C", "D"]));
    expect(c.warnings).toEqual([]);
    const r16 = Object.fromEntries(c.knockouts.filter((k) => k.stage === "r16").map((k) => [k.id, k]));
    expect(r16.r16_02!.home.team).toBe("NZL"); // 1A
    expect(r16.r16_02!.away.team).toBe("ESP"); // 3C
    expect(r16.r16_04!.away.team).toBe("URU"); // 3D meets 1B
    expect(r16.r16_05!.away.team).toBe("CHI"); // 3A meets 1C
    expect(r16.r16_06!.away.team).toBe("GEO"); // 3B meets 1D
    expect(r16.r16_01!.home.team).toBe("FIJ"); // 2C
    expect(r16.r16_01!.away.team).toBe("WAL"); // 2F
    for (const k of c.knockouts.filter((k) => k.stage === "r16")) {
      expect(k.home.team).not.toBeNull();
      expect(k.away.team).not.toBeNull();
    }
    expect(c.committed_total_required).toBe(12 + 4 + 16);
  });

  it("uses the thirds from pools C to F when those are picked", () => {
    const c = cascade(t, picks(["C", "D", "E", "F"]));
    expect(c.warnings).toEqual([]);
    const r16 = Object.fromEntries(c.knockouts.map((k) => [k.id, k]));
    expect(r16.r16_02!.away.team).toBe("ESP"); // 3C to 1A
    expect(r16.r16_04!.away.team).toBe("URU"); // 3D to 1B
    expect(r16.r16_05!.away.team).toBe("USA"); // 3E to 1C
    expect(r16.r16_06!.away.team).toBe("TGA"); // 3F to 1D
  });

  it("warns, rather than routing, when the thirds pick is not exactly four", () => {
    const c = cascade(t, picks(["A", "B", "C"]));
    expect(c.warnings.some((w) => w.code === "annex_c_third_pool_incomplete" && /exactly 4/.test(w.message))).toBe(true);
  });

  it("runs from pool picks through to the final and the bronze final", () => {
    let p = picks(["A", "B", "C", "D"]);
    for (const stage of ["r16", "qf", "sf", "tp", "f"] as const) {
      const c = cascade(t, p);
      const matches = c.knockouts.filter((k) => k.stage === stage);
      for (const m of matches) {
        expect(m.home.team, `${m.id} home`).not.toBeNull();
        expect(m.away.team, `${m.id} away`).not.toBeNull();
      }
      p = { ...p, knockouts: [...p.knockouts, ...matches.map((m) => ({ match_id: m.id, winner: m.home.team! }))] };
    }
    const done = cascade(t, p);
    expect(done.warnings).toEqual([]);
    const final = done.knockouts.find((k) => k.id === "final")!;
    expect(final.predicted_winner).toBe("NZL"); // 1A wins every home slot along the way
    const bronze = done.knockouts.find((k) => k.stage === "tp")!;
    expect(bronze.home.team).not.toBe(final.home.team);
    expect(done.committed_teams).toHaveLength(12 + 4);
  });
});
