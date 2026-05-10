/**
 * Verified-Pundit feature tests.
 *
 * Coverage:
 *   - Compute correctly identifies the top-100 of a synthetic settled
 *     tournament (and excludes 0-score brackets).
 *   - The /v1/users/:userId/pundit endpoint returns the right shape with
 *     `verified`, `levels`, `sinceDate`, `tournaments`.
 *   - Multi-tournament qualifiers get `levels = N`.
 *   - The audit JSONL writes one epoch line + one line per qualifier.
 *   - The endpoint caches reads (X-Cache: HIT on repeat calls).
 *   - The settle endpoint requires the admin token.
 */

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  TEST_ADMIN_TOKEN,
  makeBracket,
  makeMatchPrediction,
} from "./helpers.js";
import { buildServer } from "../src/server.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  recomputeVerifiedPundits,
  rollupPunditStatus,
  PUNDIT_TOP_N,
} from "../src/pundit/compute.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

async function makeTestServer(opts: { punditJsonlPath?: string } = {}) {
  return buildServer({
    dbPath: ":memory:",
    migrationsDir: MIGRATIONS_DIR,
    adminToken: TEST_ADMIN_TOKEN,
    cacheTtlMs: 100,
    rateLimit: false,
    skipPunditRecompute: true,
    punditJsonlPath: opts.punditJsonlPath,
  });
}

async function submitBracket(
  app: Awaited<ReturnType<typeof buildServer>>["app"],
  tournamentId: string,
  userId: string,
  bracketId: string,
  pick: "home_win" | "draw" | "away_win",
  matchId = "20",
) {
  const bracket = makeBracket(bracketId, {
    [matchId]: makeMatchPrediction(matchId, pick),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/bracket/submit",
    payload: { tournament_id: tournamentId, user_id: userId, bracket },
  });
  expect(res.statusCode).toBe(201);
}

async function settleMatch(
  app: Awaited<ReturnType<typeof buildServer>>["app"],
  tournamentId: string,
  matchId: string,
  outcome: "home_win" | "draw" | "away_win",
) {
  const res = await app.inject({
    method: "POST",
    url: `/v1/match/${matchId}/result`,
    headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    payload: {
      tournament_id: tournamentId,
      outcome,
      stage: "group",
      impliedAtLock: 0.4,
      secondsSinceLock: 0,
      windowSeconds: 30 * 24 * 60 * 60,
    },
  });
  expect(res.statusCode).toBe(200);
}

describe("verified-pundit / compute", () => {
  it("identifies the top-100 of a settled tournament and skips zero-scorers", async () => {
    const built = await makeTestServer();
    const { app, store } = built;
    try {
      // Seed: 5 users — 3 pick correctly (home_win), 2 pick draw.
      await submitBracket(app, "t-mini", "u_correct_a", "bk_a", "home_win");
      await submitBracket(app, "t-mini", "u_correct_b", "bk_b", "home_win");
      await submitBracket(app, "t-mini", "u_correct_c", "bk_c", "home_win");
      await submitBracket(app, "t-mini", "u_wrong_a", "bk_d", "draw");
      await submitBracket(app, "t-mini", "u_wrong_b", "bk_e", "draw");
      await settleMatch(app, "t-mini", "20", "home_win");

      store.markTournamentSettled("t-mini", 1717_000_000_000);
      const result = recomputeVerifiedPundits({
        store,
        suppressJsonl: true,
        now: () => 1717_100_000_000,
      });

      expect(result.tournamentsScanned).toBe(1);
      // Only the three correct pickers qualify; the two with score 0 do not.
      expect(result.qualified).toBe(3);

      // Each of the three has a record; the wrong-pickers have none.
      const a = store.listPunditRecordsForUser("u_correct_a");
      expect(a).toHaveLength(1);
      expect(a[0].tournament_id).toBe("t-mini");
      expect(a[0].final_rank).toBeGreaterThanOrEqual(1);
      expect(a[0].final_rank).toBeLessThanOrEqual(3);

      const wrong = store.listPunditRecordsForUser("u_wrong_a");
      expect(wrong).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("multi-tournament qualifiers accumulate `levels`", async () => {
    const built = await makeTestServer();
    const { app, store } = built;
    try {
      // Same user qualifies in two tournaments by picking correctly in both.
      await submitBracket(app, "t-1", "u_multi", "bk_m1", "home_win", "10");
      await settleMatch(app, "t-1", "10", "home_win");
      await submitBracket(app, "t-2", "u_multi", "bk_m2", "away_win", "11");
      await settleMatch(app, "t-2", "11", "away_win");

      store.markTournamentSettled("t-1", 1700_000_000_000);
      store.markTournamentSettled("t-2", 1710_000_000_000);
      recomputeVerifiedPundits({ store, suppressJsonl: true, now: () => 1720_000_000_000 });

      const records = store.listPunditRecordsForUser("u_multi");
      const status = rollupPunditStatus(records);
      expect(status.verified).toBe(true);
      expect(status.levels).toBe(2);
      expect(status.tournaments.sort()).toEqual(["t-1", "t-2"]);
      expect(status.sinceDate).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("exposes PUNDIT_TOP_N === 100", () => {
    expect(PUNDIT_TOP_N).toBe(100);
  });

  it("rollupPunditStatus treats no records as un-verified", () => {
    const status = rollupPunditStatus([]);
    expect(status).toEqual({
      verified: false,
      levels: 0,
      sinceDate: null,
      tournaments: [],
    });
  });

  it("writes one epoch + one qualifier line to the audit JSONL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vtorn-pundit-"));
    const jsonlPath = join(dir, "verified_pundit_v1.jsonl");
    const built = await makeTestServer({ punditJsonlPath: jsonlPath });
    const { app, store } = built;
    try {
      await submitBracket(app, "t-jsonl", "u_a", "bk_a", "home_win");
      await submitBracket(app, "t-jsonl", "u_b", "bk_b", "draw");
      await settleMatch(app, "t-jsonl", "20", "home_win");
      store.markTournamentSettled("t-jsonl", 1700_000_000_000);

      recomputeVerifiedPundits({ store, jsonlPath, now: () => 1700_100_000_000 });
      expect(existsSync(jsonlPath)).toBe(true);
      const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
      expect(lines.length).toBe(2); // 1 epoch + 1 qualifier
      const epoch = JSON.parse(lines[0]);
      expect(epoch.type).toBe("epoch");
      expect(epoch.tournaments).toContain("t-jsonl");
      const q = JSON.parse(lines[1]);
      expect(q.type).toBe("qualifier");
      expect(q.user_id).toBe("u_a");
      expect(q.tournament_id).toBe("t-jsonl");
      expect(q.final_rank).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("verified-pundit / endpoint", () => {
  const builtPromise = makeTestServer();
  afterAll(async () => {
    const { app } = await builtPromise;
    await app.close();
  });

  it("returns un-verified for a user with no records", async () => {
    const { app } = await builtPromise;
    const res = await app.inject({
      method: "GET",
      url: "/v1/users/u_unknown/pundit",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      verified: false,
      levels: 0,
      sinceDate: null,
      tournaments: [],
    });
    expect(res.headers["cache-control"]).toContain("max-age=60");
  });

  it("returns verified=true after the admin settle endpoint runs", async () => {
    const { app } = await builtPromise;
    await submitBracket(app, "t-end", "u_end_winner", "bk_end_w", "home_win");
    await submitBracket(app, "t-end", "u_end_loser", "bk_end_l", "draw");
    await settleMatch(app, "t-end", "20", "home_win");

    const settle = await app.inject({
      method: "POST",
      url: "/v1/admin/tournaments/t-end/settle",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: { name: "Test Cup 2026" },
    });
    expect(settle.statusCode).toBe(200);
    const settleBody = settle.json();
    expect(settleBody.compute.qualified).toBeGreaterThanOrEqual(1);

    const res = await app.inject({
      method: "GET",
      url: "/v1/users/u_end_winner/pundit",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verified).toBe(true);
    expect(body.levels).toBeGreaterThanOrEqual(1);
    expect(body.tournaments).toContain("t-end");
    expect(typeof body.sinceDate).toBe("string");
  });

  it("caches reads — repeat call within TTL is a HIT", async () => {
    const { app } = await builtPromise;
    // Fresh user id never queried before so the first read must MISS.
    const fresh = `u_cache_${Date.now()}`;
    const first = await app.inject({
      method: "GET",
      url: `/v1/users/${fresh}/pundit`,
    });
    expect(first.headers["x-cache"]).toBe("MISS");
    const second = await app.inject({
      method: "GET",
      url: `/v1/users/${fresh}/pundit`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
  });

  it("rejects an empty user id with 400", async () => {
    const { app } = await builtPromise;
    const res = await app.inject({
      method: "GET",
      url: "/v1/users/%20/pundit",
    });
    expect(res.statusCode).toBe(400);
  });

  it("settle endpoint rejects calls without the admin token", async () => {
    const { app } = await builtPromise;
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/tournaments/t-no-auth/settle",
    });
    expect(res.statusCode).toBe(401);
  });
});
