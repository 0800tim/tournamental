/**
 * Vitest — group assembly + upcoming-matches selection from real data.
 */

import { describe, it, expect } from "vitest";

import {
  buildGroups,
  upcomingMatches,
  firstFixturesForTeam,
  syntheticGroupProbabilities,
  allTeams,
  teamByCode,
} from "../app/world-cup-2026/landing/_lib/groups";

describe("buildGroups", () => {
  const groups = buildGroups();

  it("has 12 groups labelled A through L", () => {
    expect(groups).toHaveLength(12);
    expect(groups.map((g) => g.id)).toEqual(
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
    );
  });

  it("each group has 4 teams", () => {
    for (const g of groups) {
      expect(g.teams).toHaveLength(4);
    }
  });

  it("teams within a group are FIFA-rank ordered", () => {
    for (const g of groups) {
      const ranks = g.teams.map((t) => t.fifa_ranking_at_2026);
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(ranks).toEqual(sorted);
    }
  });

  it("contains the real Final Draw composition for Group J (ARG)", () => {
    const j = groups.find((g) => g.id === "J");
    expect(j).toBeDefined();
    const codes = new Set(j!.teams.map((t) => t.code));
    expect(codes).toEqual(new Set(["ARG", "ALG", "AUT", "JOR"]));
  });
});

describe("allTeams + teamByCode", () => {
  it("includes 48 teams", () => {
    expect(allTeams()).toHaveLength(48);
  });

  it("looks up Argentina by FIFA code", () => {
    const arg = teamByCode("ARG");
    expect(arg?.name).toBe("Argentina");
    expect(arg?.fifa_ranking_at_2026).toBe(1);
  });

  it("returns undefined for unknown codes", () => {
    expect(teamByCode("XYZ")).toBeUndefined();
  });
});

describe("upcomingMatches", () => {
  it("returns 12 matches by default, all from group stage", () => {
    const m = upcomingMatches();
    expect(m).toHaveLength(12);
    for (const fx of m) {
      expect(fx.stage.startsWith("group_")).toBe(true);
      expect(fx.home).toBeDefined();
      expect(fx.away).toBeDefined();
    }
  });

  it("returns matches in chronological order", () => {
    const m = upcomingMatches(20);
    for (let i = 1; i < m.length; i++) {
      expect(Date.parse(m[i].kickoff_utc)).toBeGreaterThanOrEqual(
        Date.parse(m[i - 1].kickoff_utc),
      );
    }
  });

  it("first match is Mexico vs South Africa on 2026-06-11", () => {
    const [first] = upcomingMatches(1);
    expect(first.home.code).toBe("MEX");
    expect(first.away.code).toBe("RSA");
    expect(first.kickoff_utc.startsWith("2026-06-11")).toBe(true);
  });

  it("respects an explicit limit", () => {
    expect(upcomingMatches(3)).toHaveLength(3);
  });
});

describe("firstFixturesForTeam", () => {
  it("returns up to 3 fixtures for ARG, all involving ARG", () => {
    const fx = firstFixturesForTeam("ARG", 3);
    expect(fx.length).toBeGreaterThan(0);
    expect(fx.length).toBeLessThanOrEqual(3);
    for (const f of fx) {
      const involves = f.home_team_slot === "ARG" || f.away_team_slot === "ARG";
      expect(involves).toBe(true);
    }
  });
});

describe("syntheticGroupProbabilities", () => {
  it("sums to ~100% per group", () => {
    for (const g of buildGroups()) {
      const ps = syntheticGroupProbabilities(g);
      const total = ps.reduce((acc, x) => acc + x.pct, 0);
      // Rounding can drift by ±2 over 4 teams.
      expect(total).toBeGreaterThanOrEqual(98);
      expect(total).toBeLessThanOrEqual(102);
    }
  });

  it("favours the higher-ranked team", () => {
    for (const g of buildGroups()) {
      const ps = syntheticGroupProbabilities(g);
      const top = ps[0];
      const topRank = top.team.fifa_ranking_at_2026;
      for (const p of ps.slice(1)) {
        // The top of the list is the highest pct; if there is a tie in
        // pct, FIFA-rank order should still hold.
        if (p.pct === top.pct) continue;
        expect(p.pct).toBeLessThan(top.pct);
        // Tied pcts aside, the top team has a better (smaller) rank.
        if (p.team.fifa_ranking_at_2026 !== topRank) {
          expect(topRank).toBeLessThan(p.team.fifa_ranking_at_2026);
        }
      }
    }
  });
});
