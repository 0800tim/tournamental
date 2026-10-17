/**
 * lib/archive/final-standings.ts against throwaway SQLite files, never
 * the production game.db. Covers rank ordering and ties, the
 * percentage-only shape, name resolution across the two databases and
 * the knockout-results filter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  KNOCKOUT_STAGE_LABEL,
  KNOCKOUT_STAGE_ORDER,
  loadFinalStandings,
  loadKnockoutResults,
} from "@/lib/archive/final-standings";

const T = "fifa-wc-2026";
let dir: string;
let gameDb: Database.Database;
let authDb: Database.Database;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tnm-archive-standings-"));
  const gamePath = join(dir, "game.db");
  const authPath = join(dir, "auth.db");
  gameDb = new Database(gamePath);
  gameDb.exec(`
    CREATE TABLE brackets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tournament_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}', locked_at INTEGER NOT NULL,
      score_total INTEGER NOT NULL DEFAULT 0, correct_picks INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE syndicate_owners_membership (
      syndicate_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner',
      joined_at INTEGER NOT NULL, handle TEXT, display_name TEXT,
      PRIMARY KEY (syndicate_id, user_id)
    );
    CREATE TABLE match_results (
      match_id TEXT NOT NULL, tournament_id TEXT NOT NULL, outcome TEXT NOT NULL,
      recorded_at INTEGER NOT NULL, PRIMARY KEY (match_id, tournament_id)
    );
  `);
  authDb = new Database(authPath);
  authDb.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, display_name TEXT, created_at INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL DEFAULT 0)`);
  process.env.VTORN_GAME_DB_PATH = gamePath;
  process.env.AUTH_DB_PATH = authPath;
});

afterAll(() => {
  gameDb.close();
  authDb.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.VTORN_GAME_DB_PATH;
  delete process.env.AUTH_DB_PATH;
});

beforeEach(() => {
  gameDb.exec("DELETE FROM brackets; DELETE FROM syndicate_owners_membership; DELETE FROM match_results;");
  authDb.exec("DELETE FROM user");
});

function bracket(userId: string, score: number, correct: number, lockedAt = 1_000, tournament = T) {
  gameDb
    .prepare("INSERT INTO brackets (id, user_id, tournament_id, locked_at, score_total, correct_picks) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`b_${userId}_${tournament}`, userId, tournament, lockedAt, score, correct);
}

function member(userId: string, handle: string | null, displayName: string | null, syndicate = "s1") {
  gameDb
    .prepare("INSERT INTO syndicate_owners_membership (syndicate_id, user_id, joined_at, handle, display_name) VALUES (?, ?, 0, ?, ?)")
    .run(syndicate, userId, handle, displayName);
}

function result(matchId: string, outcome: Record<string, unknown> | string, recordedAt: number, tournament = T) {
  gameDb
    .prepare("INSERT INTO match_results (match_id, tournament_id, outcome, recorded_at) VALUES (?, ?, ?, ?)")
    .run(matchId, tournament, typeof outcome === "string" ? outcome : JSON.stringify(outcome), recordedAt);
}

describe("loadFinalStandings: ordering", () => {
  it("ranks by points, then correct picks, then earliest lock", () => {
    bracket("u_c", 90, 60, 3_000);
    bracket("u_a", 100, 70, 2_000);
    bracket("u_b", 100, 70, 1_000); // same score and correct as u_a, locked earlier
    bracket("u_d", 100, 65, 500); // same score, fewer correct
    const rows = loadFinalStandings(T, 104);
    expect(rows.map((r) => [r.rank, r.points, r.correct])).toEqual([
      [1, 100, 70],
      [2, 100, 70],
      [3, 100, 65],
      [4, 90, 60],
    ]);
    // Tie on points and correct: the earlier lock ranks first.
    member("u_a", "a", null);
    member("u_b", "b", null);
    expect(loadFinalStandings(T, 104).slice(0, 2).map((r) => r.name)).toEqual(["b", "a"]);
  });

  it("gives consecutive ranks even on ties (no shared ranks)", () => {
    for (let i = 0; i < 5; i++) bracket(`u_${i}`, 50, 30, 1_000 + i);
    expect(loadFinalStandings(T, 104).map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns at most the limit, default ten", () => {
    for (let i = 0; i < 14; i++) bracket(`u_${i}`, 100 - i, 60 - i);
    expect(loadFinalStandings(T, 104)).toHaveLength(10);
    expect(loadFinalStandings(T, 104, 3).map((r) => r.points)).toEqual([100, 99, 98]);
    expect(loadFinalStandings(T, 104, 50)).toHaveLength(14);
  });

  it("only reads the requested tournament", () => {
    bracket("u_x", 100, 70, 1_000, "other-cup");
    bracket("u_y", 10, 5);
    const rows = loadFinalStandings(T, 104);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.points).toBe(10);
  });
});

describe("loadFinalStandings: percentages only", () => {
  it("rounds correct picks over total matches to a whole percent", () => {
    bracket("u_a", 500, 72); // 72 of 104 = 69.2
    bracket("u_b", 400, 54); // 51.9
    bracket("u_c", 300, 0);
    const [a, b, c] = loadFinalStandings(T, 104);
    expect(a!.percentCorrect).toBe(69);
    expect(b!.percentCorrect).toBe(52);
    expect(c!.percentCorrect).toBe(0);
  });

  it("guards a zero total so it never divides by zero", () => {
    bracket("u_a", 1, 1);
    expect(loadFinalStandings(T, 0)[0]!.percentCorrect).toBe(100);
  });

  it("exposes rank, name, percent and the per-player numbers but no population total", () => {
    bracket("u_a", 10, 5);
    const row = loadFinalStandings(T, 104)[0]!;
    expect(Object.keys(row).sort()).toEqual(["correct", "name", "percentCorrect", "points", "rank"]);
  });
});

describe("loadFinalStandings: names", () => {
  it("prefers display_name, then handle, from any pool membership", () => {
    bracket("u_a", 3, 1);
    bracket("u_b", 2, 1);
    member("u_a", "alice_h", "Alice");
    member("u_b", "bob_h", null);
    expect(loadFinalStandings(T, 104).map((r) => r.name)).toEqual(["Alice", "bob_h"]);
  });

  it("falls back to the auth database display name, then to Player", () => {
    bracket("u_a", 3, 1);
    bracket("u_b", 2, 1);
    bracket("u_c", 1, 1);
    member("u_b", null, null); // membership row with no names at all
    authDb.prepare("INSERT INTO user (id, display_name) VALUES (?, ?)").run("u_a", "Auth Alice");
    authDb.prepare("INSERT INTO user (id, display_name) VALUES (?, ?)").run("u_b", null);
    expect(loadFinalStandings(T, 104).map((r) => r.name)).toEqual(["Auth Alice", "Player", "Player"]);
  });

  it("still works when the auth database is not configured", () => {
    bracket("u_a", 3, 1);
    const saved = process.env.AUTH_DB_PATH;
    delete process.env.AUTH_DB_PATH;
    try {
      expect(loadFinalStandings(T, 104)[0]!.name).toBe("Player");
    } finally {
      process.env.AUTH_DB_PATH = saved;
    }
  });
});

describe("loadFinalStandings: missing or broken database", () => {
  it("returns an empty list when the game database file does not exist", () => {
    const saved = process.env.VTORN_GAME_DB_PATH;
    process.env.VTORN_GAME_DB_PATH = join(dir, "nope.db");
    try {
      expect(loadFinalStandings(T, 104)).toEqual([]);
      expect(loadKnockoutResults(T)).toEqual([]);
    } finally {
      process.env.VTORN_GAME_DB_PATH = saved;
    }
  });

  it("returns an empty list rather than throwing on a database without the tables", () => {
    const p = join(dir, "empty.db");
    writeFileSync(p, "");
    const saved = process.env.VTORN_GAME_DB_PATH;
    process.env.VTORN_GAME_DB_PATH = p;
    try {
      expect(loadFinalStandings(T, 104)).toEqual([]);
      expect(loadKnockoutResults(T)).toEqual([]);
    } finally {
      process.env.VTORN_GAME_DB_PATH = saved;
    }
  });
});

describe("loadKnockoutResults", () => {
  it("returns round of 16 onward in recorded order with parsed scores", () => {
    result("final", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "ESP", method: "aet", stage: "final" }, 900);
    result("sf_01", { outcome: "home_win", homeScore: 2, awayScore: 0, winner: "ESP" }, 700);
    result("qf_03", { outcome: "away_win", homeScore: 1, awayScore: 2, winner: "ARG" }, 600);
    result("r16_02", { outcome: "home_win", homeScore: 3, awayScore: 1, winner: "ENG" }, 500);
    result("tp", { outcome: "home_win", homeScore: 6, awayScore: 4, winner: "ENG", method: "pens" }, 800);
    const rows = loadKnockoutResults(T);
    expect(rows.map((r) => r.matchId)).toEqual(["r16_02", "qf_03", "sf_01", "tp", "final"]);
    expect(rows[0]).toEqual({ matchId: "r16_02", stage: "r16", homeScore: 3, awayScore: 1, winner: "ENG", method: null });
    expect(rows[4]).toEqual({ matchId: "final", stage: "final", homeScore: 1, awayScore: 0, winner: "ESP", method: "aet" });
    expect(rows[3]!.stage).toBe("tp");
  });

  it("includes the round of 32 and leaves out group matches", () => {
    result("1", { outcome: "home_win", homeScore: 2, awayScore: 0 }, 100);
    result("72", { outcome: "draw", homeScore: 1, awayScore: 1 }, 200);
    result("r32_01", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "ESP" }, 300);
    result("r16_01", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "ESP" }, 400);
    const rows = loadKnockoutResults(T);
    expect(rows.map((r) => r.matchId)).toEqual(["r32_01", "r16_01"]);
    expect(rows[0]!.stage).toBe("r32");
  });

  it("returns all 16 round-of-32 results, each under a stage the home page lists", () => {
    for (let i = 1; i <= 16; i++) {
      const id = `r32_${String(i).padStart(2, "0")}`;
      result(id, { outcome: "home_win", homeScore: 2, awayScore: 1, winner: `T${i}` }, 1_000 + i);
    }
    const rows = loadKnockoutResults(T);
    expect(rows).toHaveLength(16);
    expect(new Set(rows.map((r) => r.stage))).toEqual(new Set(["r32"]));
    expect(rows.map((r) => r.matchId)[15]).toBe("r32_16");
    for (const r of rows) expect(KNOCKOUT_STAGE_ORDER).toContain(r.stage);
  });

  it("tolerates malformed JSON and missing fields", () => {
    result("qf_01", "not json", 100);
    result("qf_02", { outcome: "home_win", homeScore: "2", winner: 7 }, 200);
    const rows = loadKnockoutResults(T);
    expect(rows[0]).toEqual({ matchId: "qf_01", stage: "qf", homeScore: null, awayScore: null, winner: null, method: null });
    expect(rows[1]).toEqual({ matchId: "qf_02", stage: "qf", homeScore: null, awayScore: null, winner: null, method: null });
  });

  it("only reads the requested tournament", () => {
    result("final", { outcome: "home_win", winner: "NZL" }, 100, "rwc-2027");
    expect(loadKnockoutResults(T)).toEqual([]);
  });
});

describe("knockout stage order and labels", () => {
  it("lists the final first and the round of 32 last", () => {
    expect(KNOCKOUT_STAGE_ORDER[0]).toBe("f");
    expect(KNOCKOUT_STAGE_ORDER[KNOCKOUT_STAGE_ORDER.length - 1]).toBe("r32");
    expect(KNOCKOUT_STAGE_ORDER).toEqual(["f", "tp", "sf", "qf", "r16", "r32"]);
  });

  it("has a human label for every listed stage", () => {
    for (const s of KNOCKOUT_STAGE_ORDER) expect(KNOCKOUT_STAGE_LABEL[s]).toBeTruthy();
    expect(KNOCKOUT_STAGE_LABEL.r32).toBe("Round of 32");
  });

  it("covers every stage the loader can produce from the fixture ids", () => {
    result("r32_01", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "A" }, 100);
    result("r16_01", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "A" }, 200);
    result("qf_01", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "A" }, 300);
    result("sf_01", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "A" }, 400);
    result("tp", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "A" }, 500);
    result("final", { outcome: "home_win", homeScore: 1, awayScore: 0, winner: "A", stage: "f" }, 600);
    const stages = new Set(loadKnockoutResults(T).map((r) => r.stage));
    for (const s of stages) expect(KNOCKOUT_STAGE_ORDER).toContain(s);
  });
});
