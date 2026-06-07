/**
 * Browser-swarm federation endpoints.
 *
 *   POST /v1/swarm/commit
 *   GET  /v1/swarm/leaderboard
 *   GET  /v1/swarm/proof/:merkle_root
 *   GET  /v1/swarm/proof/:merkle_root/file/:filename
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

function mockOtsFetch(): typeof fetch {
  // Stand in for the OTS calendar: POST /digest returns 3 bytes of
  // pending payload; GET /timestamp/<hex> returns a payload that
  // contains the Bitcoin attestation magic so the verify route flips
  // to confirmed.
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.endsWith("/digest")) {
      return new Response(new Uint8Array([0xf1, 0x04, 0x01]).buffer, {
        status: 200,
      });
    }
    if (url.includes("/timestamp/")) {
      // BTC attestation magic embedded.
      return new Response(
        new Uint8Array([
          0xff, 0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01,
        ]).buffer,
        { status: 200 },
      );
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

async function makeSwarmServer() {
  return buildServer({
    dbPath: ":memory:",
    migrationsDir: MIGRATIONS_DIR,
    adminToken: "test-admin",
    cacheTtlMs: 50,
    rateLimit: false,
    skipPunditRecompute: true,
    otsFetch: mockOtsFetch(),
    otsCalendars: ["https://a.example.com", "https://b.example.com"],
    publicBaseUrl: "https://play.tournamental.com",
  });
}

const VALID_ROOT_A = "a".repeat(64);
const VALID_ROOT_B = "b".repeat(64);

describe("POST /v1/swarm/commit", () => {
  const built = makeSwarmServer();

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("persists a swarm summary and submits to OTS calendars", async () => {
    const { app, store } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/swarm/commit",
      payload: {
        node_id: "browser-abc12345",
        run_id: "run-aaa-111",
        master_seed: "tournamental-browser-v1",
        strategy: "chalk-v1",
        total_bots: 100,
        merkle_root: VALID_ROOT_A,
        top_n_claim: { bot_index: 7, claimed_score: 0.95, picks_count: 64 },
        started_at: Date.now() - 60_000,
        finished_at: Date.now(),
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ots_status).toBe("pending");
    expect(body.pending_calendars).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
    expect(body.ots_proof_url).toBe(
      `https://play.tournamental.com/v1/swarm/proof/${VALID_ROOT_A}`,
    );

    const row = store.swarmClaims.getByMerkleRoot(VALID_ROOT_A);
    expect(row).not.toBeNull();
    expect(row!.total_bots).toBe(100);
    expect(row!.ots_status).toBe("pending");
    const pending = store.swarmClaims.parsePending(row!);
    expect(pending).toHaveLength(2);
  });

  it("rejects a malformed merkle_root", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/swarm/commit",
      payload: {
        node_id: "browser-abc12345",
        run_id: "run-bad-merkle",
        master_seed: "x",
        total_bots: 10,
        merkle_root: "not-hex",
        top_n_claim: { bot_index: 0, claimed_score: 0, picks_count: 0 },
        started_at: 1,
        finished_at: 2,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid node_id shape", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/swarm/commit",
      payload: {
        node_id: "hacker!@#",
        run_id: "ok-run",
        master_seed: "x",
        total_bots: 10,
        merkle_root: VALID_ROOT_B,
        top_n_claim: { bot_index: 0, claimed_score: 0, picks_count: 0 },
        started_at: 1,
        finished_at: 2,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/swarm/leaderboard + /v1/swarm/proof/...", () => {
  const built = makeSwarmServer();

  beforeAll(async () => {
    const { app } = await built;
    // Seed 3 claims with descending scores.
    const make = async (
      runId: string,
      root: string,
      score: number,
      botIndex: number,
    ) =>
      app.inject({
        method: "POST",
        url: "/v1/swarm/commit",
        payload: {
          node_id: "browser-1234abcd",
          run_id: runId,
          master_seed: "tournamental-browser-v1",
          strategy: "chalk-v1",
          total_bots: 100,
          merkle_root: root,
          top_n_claim: {
            bot_index: botIndex,
            claimed_score: score,
            picks_count: 64,
          },
          started_at: Date.now() - 60_000,
          finished_at: Date.now(),
        },
      });

    await make("lb-1", "1".padEnd(64, "0"), 0.5, 1);
    await make("lb-2", "2".padEnd(64, "0"), 0.9, 2);
    await make("lb-3", "3".padEnd(64, "0"), 0.7, 3);
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("ranks claims by claimed_score desc", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/swarm/leaderboard?limit=10",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
    expect(body.rows.map((r: { claimed_score: number }) => r.claimed_score)).toEqual([
      0.9, 0.7, 0.5,
    ]);
    expect(body.rows[0].ots_proof_url).toContain("/v1/swarm/proof/");
    expect(body.rows[0].bot_index).toBe(2);
  });

  it("returns proof metadata for a known root", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarm/proof/${"2".padEnd(64, "0")}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.merkle_root).toBe("2".padEnd(64, "0"));
    expect(body.ots_status).toBe("pending");
    expect(body.pending_calendars).toHaveLength(2);
    expect(body.pending_calendars[0]).toHaveProperty("calendar_slug");
    expect(body.pending_calendars[0]).toHaveProperty("download_url");
    expect(body.upgraded).toBeNull();
  });

  it("404s on a root that hasn't been committed", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarm/proof/${"d".repeat(64)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s on a malformed root", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/swarm/proof/not-hex",
    });
    expect(res.statusCode).toBe(400);
  });

  it("serves an .ots file for a pending calendar", async () => {
    const { app } = await built;
    const root = "2".padEnd(64, "0");
    // a.example.com -> a-example-com
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarm/proof/${root}/file/a-example-com.ots`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain(
      "application/vnd.opentimestamps.ots",
    );
    const body = res.rawPayload;
    // First byte of the OTS magic header.
    expect(body[0]).toBe(0x00);
    // Version byte.
    expect(body[31]).toBe(0x01);
  });

  it("409s on upgraded.ots before the scheduler has confirmed", async () => {
    const { app } = await built;
    const root = "2".padEnd(64, "0");
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarm/proof/${root}/file/upgraded.ots`,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("scheduler upgrade integration", () => {
  it("flips a row to 'confirmed' once the calendar returns a BTC attestation", async () => {
    const { app, store } = await makeSwarmServer();
    try {
      const root = "c".repeat(64);
      await app.inject({
        method: "POST",
        url: "/v1/swarm/commit",
        payload: {
          node_id: "browser-deadbeef",
          run_id: "sched-1",
          master_seed: "x",
          total_bots: 10,
          merkle_root: root,
          top_n_claim: {
            bot_index: 0,
            claimed_score: 0.5,
            picks_count: 1,
          },
          started_at: 1,
          finished_at: 2,
        },
      });

      const { OtsScheduler } = await import("../src/services/ots-scheduler.js");
      const scheduler = new OtsScheduler(store.swarmClaims, {
        fetchImpl: mockOtsFetch(),
        stalenessMs: 0,
      });
      await scheduler.tick();
      const row = store.swarmClaims.getByMerkleRoot(root);
      expect(row?.ots_status).toBe("confirmed");
      expect(row?.upgraded_ots_hex).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
