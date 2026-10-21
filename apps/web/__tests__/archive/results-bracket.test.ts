/**
 * lib/archive/results-bracket.ts: the official results bracket for the
 * read-only archive, built from recorded results in an in-memory
 * persistence (never the production game.db). The best-third checks
 * pin the behaviour introduced in commit 79286bb3: once every group is
 * settled, the eight best third-placed teams are ranked by points, goal
 * difference and goals scored from the actual results.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixtures2026, type Tournament } from "@tournamental/bracket-engine";

import { buildOfficialResultsBracket } from "@/lib/archive/results-bracket";
import { SyndicatePersistence, __setPersistenceForTests } from "@/lib/syndicate/persistence";

const tournament: Tournament = loadFixtures2026();
let persistence: SyndicatePersistence;

beforeEach(() => {
  persistence = new SyndicatePersistence({ dbPath: ":memory:" });
  persistence.ensureSchema();
  persistence.db.exec(`
    CREATE TABLE IF NOT EXISTS match_results (
      match_id TEXT NOT NULL, tournament_id TEXT NOT NULL, outcome TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, PRIMARY KEY (match_id, tournament_id)
    )
  `);
  __setPersistenceForTests(persistence);
});

afterEach(() => {
  __setPersistenceForTests(null);
});

function record(matchId: string, outcome: Record<string, unknown>, tournamentId = tournament.id) {
  persistence.db
    .prepare("INSERT OR REPLACE INTO match_results (match_id, tournament_id, outcome, recorded_at) VALUES (?, ?, ?, ?)")
    .run(matchId, tournamentId, JSON.stringify(outcome), Date.now());
}

/**
 * Deterministic group stage: within each group the lower team index
 * always wins 1-0, except the third team's win over the fourth, which
 * it wins (groupIndex + 1)-0. Every third-placed team then has 3 points
 * and 2 goals against, with goal difference groupIndex - 1, so the best
 * thirds are the thirds of the eight highest-index groups in descending
 * group order.
 */
function recordGroupStage(skipGroupIds: ReadonlySet<string> = new Set()) {
  tournament.groups.forEach((g, gi) => {
    if (skipGroupIds.has(g.id)) return;
    for (const f of tournament.group_fixtures.filter((x) => x.group_id === g.id)) {
      const homeWins = f.home_idx < f.away_idx;
      const winnerIdx = Math.min(f.home_idx, f.away_idx);
      const loserIdx = Math.max(f.home_idx, f.away_idx);
      const goals = winnerIdx === 2 && loserIdx === 3 ? gi + 1 : 1;
      record(String(f.match_no), {
        outcome: homeWins ? "home_win" : "away_win",
        homeScore: homeWins ? goals : 0,
        awayScore: homeWins ? 0 : goals,
      });
    }
  });
}

describe("buildOfficialResultsBracket: shape", () => {
  it("is an empty official bracket when nothing is recorded", () => {
    const b = buildOfficialResultsBracket(tournament);
    expect(b.bracketId).toBe("official-results");
    expect(b.matchPredictions).toEqual({});
    expect(b.knockoutPredictions).toEqual({});
    expect(b.bestThirds).toBeUndefined();
    expect(b.groupTiebreakers).toEqual({});
    expect(b.version).toBe(1);
  });

  it("copies recorded group results as predictions keyed by match number, with scores", () => {
    record("1", { outcome: "draw", homeScore: 1, awayScore: 1 });
    record("2", { outcome: "away_win" });
    const b = buildOfficialResultsBracket(tournament);
    expect(b.matchPredictions["1"]).toEqual({ matchId: "1", outcome: "draw", homeScore: 1, awayScore: 1, lockedAt: "" });
    expect(b.matchPredictions["2"]).toEqual({ matchId: "2", outcome: "away_win", lockedAt: "" });
    expect(Object.keys(b.matchPredictions)).toHaveLength(2);
  });

  it("ignores results for match ids the tournament does not have and for other tournaments", () => {
    record("999", { outcome: "home_win" });
    record("nope_01", { outcome: "home_win", winner: "ESP" });
    record("1", { outcome: "home_win" }, "rwc-2027");
    const b = buildOfficialResultsBracket(tournament);
    expect(b.matchPredictions).toEqual({});
    expect(b.knockoutPredictions).toEqual({});
  });

  it("copies knockout results keyed by knockout id", () => {
    const first = tournament.knockouts[0]!;
    record(first.id, { outcome: "away_win", homeScore: 0, awayScore: 2, winner: "ARG" });
    record("final", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "ESP" });
    const b = buildOfficialResultsBracket(tournament);
    expect(b.knockoutPredictions[first.id]).toEqual({ matchId: first.id, outcome: "away_win", homeScore: 0, awayScore: 2, lockedAt: "" });
    expect(b.knockoutPredictions["final"]).toMatchObject({ matchId: "final", outcome: "home_win", homeScore: 1, awayScore: 0 });
  });
});

describe("buildOfficialResultsBracket: best thirds from actual results (79286bb3)", () => {
  it("has 12 groups of 6 fixtures to work with", () => {
    expect(tournament.groups).toHaveLength(12);
    for (const g of tournament.groups) {
      expect(tournament.group_fixtures.filter((f) => f.group_id === g.id)).toHaveLength(6);
      expect(g.team_ids).toHaveLength(4);
    }
  });

  it("leaves best thirds undefined while any group is unsettled", () => {
    const last = tournament.groups[tournament.groups.length - 1]!;
    recordGroupStage(new Set([last.id]));
    expect(Object.keys(buildOfficialResultsBracket(tournament).matchPredictions)).toHaveLength(66);
    expect(buildOfficialResultsBracket(tournament).bestThirds).toBeUndefined();
  });

  it("leaves best thirds undefined when a group is missing a single fixture", () => {
    recordGroupStage();
    const last = tournament.group_fixtures[tournament.group_fixtures.length - 1]!;
    persistence.db.prepare("DELETE FROM match_results WHERE match_id = ?").run(String(last.match_no));
    expect(buildOfficialResultsBracket(tournament).bestThirds).toBeUndefined();
  });

  it("ranks the eight best thirds by points, goal difference and goals scored once all groups are settled", () => {
    recordGroupStage();
    const b = buildOfficialResultsBracket(tournament);
    expect(Object.keys(b.matchPredictions)).toHaveLength(72);
    const expected = [...tournament.groups]
      .map((g, gi) => ({ team: g.team_ids[2]!, gi }))
      .sort((a, c) => c.gi - a.gi)
      .slice(0, 8)
      .map((x) => x.team);
    expect(b.bestThirds).toEqual(expected);
  });

  it("breaks a full tie on points, goal difference and goals by FIFA rank, then team code", () => {
    // Every group identical: third team has 3 points, GD -1, 1 goal.
    tournament.groups.forEach((g) => {
      for (const f of tournament.group_fixtures.filter((x) => x.group_id === g.id)) {
        const homeWins = f.home_idx < f.away_idx;
        record(String(f.match_no), { outcome: homeWins ? "home_win" : "away_win", homeScore: homeWins ? 1 : 0, awayScore: homeWins ? 0 : 1 });
      }
    });
    const rankOf = (id: string) => tournament.teams.find((t) => t.id === id)?.fifa_rank ?? 99;
    const thirds = tournament.groups
      .map((g) => g.team_ids[2]!)
      .sort((a, c) => rankOf(a) - rankOf(c) || a.localeCompare(c))
      .slice(0, 8);
    expect(buildOfficialResultsBracket(tournament).bestThirds).toEqual(thirds);
  });
});
