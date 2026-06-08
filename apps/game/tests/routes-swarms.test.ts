/**
 * Operator-keyed swarm-summary endpoints.
 *
 *   POST /v1/swarms/:operator_id/summary
 *   GET  /v1/swarms/:operator_id
 *   GET  /v1/swarms
 *   GET  /v1/perfect-track
 *
 * Spec: A13 task brief.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashApiKey } from "../src/store/api-keys.js";
import { makeServer } from "./helpers.js";

const VALID_ROOT = "a".repeat(64);

function aliveRows(rows: Array<{ n: number; alive_count: number }>) {
  return rows;
}

describe("POST /v1/swarms/:operator_id/summary", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  let plainKey = "";
  let operatorId = "";

  beforeAll(async () => {
    const { store } = await built;
    const issued = store.apiKeys.issue({
      owner_email: "owner@example.com",
      label: "swarm-operator",
    });
    plainKey = issued.api_key;
    operatorId = hashApiKey(plainKey);
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("rejects requests without an API key", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      payload: {
        total_bots: 100,
        bots_alive_after_match_n: [],
        best_bot_score: 10,
        top_k: [],
        merkle_root: VALID_ROOT,
        kickoff_at: Date.now() + 60_000,
        generated_at: Date.now(),
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects when the operator_id does not match the key hash", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: `/v1/swarms/${"b".repeat(64)}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 100,
        bots_alive_after_match_n: [],
        best_bot_score: 10,
        top_k: [],
        merkle_root: VALID_ROOT,
        kickoff_at: Date.now() + 60_000,
        generated_at: Date.now(),
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_operator");
  });

  it("rejects an invalid operator_id (not hex)", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: `/v1/swarms/not-a-hash/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 0,
        bots_alive_after_match_n: [],
        best_bot_score: 0,
        top_k: [],
        merkle_root: VALID_ROOT,
        kickoff_at: 0,
        generated_at: 0,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid summary and persists it", async () => {
    const { app, store } = await built;
    const kickoffAt = Date.now() + 60_000;
    const res = await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 12_345,
        bots_alive_after_match_n: aliveRows([
          { n: 1, alive_count: 1000 },
          { n: 2, alive_count: 800 },
        ]),
        best_bot_score: 42,
        top_k: [
          { bot_id: "bot_001", score: 42, chalk_score: 0.91 },
          { bot_id: "bot_002", score: 41, chalk_score: 0.88 },
        ],
        merkle_root: VALID_ROOT,
        kickoff_at: kickoffAt,
        generated_at: Date.now(),
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.operator_id).toBe(operatorId);
    expect(body.total_bots).toBe(12_345);
    expect(body.best_bot_score).toBe(42);

    const row = store.swarmSummaries.getByCompositeKey(operatorId, kickoffAt);
    expect(row).not.toBeNull();
    expect(row!.total_bots).toBe(12_345);
    expect(row!.merkle_root).toBe(VALID_ROOT);
  });

  it("is idempotent on (operator_id, kickoff_at)", async () => {
    const { app, store } = await built;
    const kickoffAt = Date.now() + 120_000;
    const first = await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 100,
        bots_alive_after_match_n: [],
        best_bot_score: 5,
        top_k: [],
        merkle_root: VALID_ROOT,
        kickoff_at: kickoffAt,
        generated_at: Date.now(),
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 200, // higher
        bots_alive_after_match_n: [{ n: 5, alive_count: 50 }],
        best_bot_score: 8,
        top_k: [],
        merkle_root: VALID_ROOT,
        kickoff_at: kickoffAt,
        generated_at: Date.now() + 1,
      },
    });
    expect(second.statusCode).toBe(201);

    const row = store.swarmSummaries.getByCompositeKey(operatorId, kickoffAt);
    expect(row!.total_bots).toBe(200);
    expect(row!.best_bot_score).toBe(8);
  });

  it("rejects merkle_root that is not 64 hex chars", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 1,
        bots_alive_after_match_n: [],
        best_bot_score: 0,
        top_k: [],
        merkle_root: "not-hex",
        kickoff_at: Date.now(),
        generated_at: Date.now(),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects top_k over 1,000 rows", async () => {
    const { app } = await built;
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({
      bot_id: `b_${i}`,
      score: 1,
      chalk_score: 0.5,
    }));
    const res = await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 1,
        bots_alive_after_match_n: [],
        best_bot_score: 0,
        top_k: tooMany,
        merkle_root: VALID_ROOT,
        kickoff_at: Date.now(),
        generated_at: Date.now(),
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/swarms/:operator_id", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  let plainKey = "";
  let operatorId = "";

  beforeAll(async () => {
    const { store, app } = await built;
    const issued = store.apiKeys.issue({ owner_email: "get@example.com" });
    plainKey = issued.api_key;
    operatorId = hashApiKey(plainKey);
    // Seed one summary so the GET has something to return.
    await app.inject({
      method: "POST",
      url: `/v1/swarms/${operatorId}/summary`,
      headers: { authorization: `Bearer ${plainKey}` },
      payload: {
        total_bots: 500,
        bots_alive_after_match_n: [{ n: 1, alive_count: 100 }],
        best_bot_score: 23,
        top_k: [{ bot_id: "bot_top", score: 23, chalk_score: 0.95 }],
        merkle_root: VALID_ROOT,
        kickoff_at: 1_700_000_000_000,
        generated_at: 1_700_000_000_100,
      },
    });
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("returns the latest summary with edge cache headers", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarms/${operatorId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
    expect(res.headers["cache-control"]).toContain("stale-while-revalidate=300");
    expect(res.headers["etag"]).toBeDefined();
    const body = res.json();
    expect(body.operator_id).toBe(operatorId);
    expect(body.total_bots).toBe(500);
    expect(body.bots_alive_after_match_n).toHaveLength(1);
    expect(body.top_k).toHaveLength(1);
    expect(body.top_k[0].bot_id).toBe("bot_top");
  });

  it("returns 304 when If-None-Match matches", async () => {
    const { app } = await built;
    const first = await app.inject({
      method: "GET",
      url: `/v1/swarms/${operatorId}`,
    });
    const etag = first.headers["etag"] as string;
    expect(etag).toBeDefined();

    const second = await app.inject({
      method: "GET",
      url: `/v1/swarms/${operatorId}`,
      headers: { "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
  });

  it("returns 404 for an unknown operator_id", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarms/${"f".repeat(64)}`,
    });
    expect(res.statusCode).toBe(404);
    // Still edge-cached so 404 probes don't pummel the origin.
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
  });

  it("rejects an invalid operator_id", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/swarms/not-hex`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/swarms (global aggregate)", () => {
  const built = makeServer({ cacheTtlMs: 50 });

  beforeAll(async () => {
    const { store, app } = await built;
    // Three operators with varying best_bot_score.
    for (let i = 0; i < 3; i++) {
      const issued = store.apiKeys.issue({
        owner_email: `op${i}@example.com`,
      });
      const operatorId = hashApiKey(issued.api_key);
      await app.inject({
        method: "POST",
        url: `/v1/swarms/${operatorId}/summary`,
        headers: { authorization: `Bearer ${issued.api_key}` },
        payload: {
          total_bots: 1000 * (i + 1),
          bots_alive_after_match_n: [],
          best_bot_score: 10 + i * 10, // 10, 20, 30
          top_k: [],
          merkle_root: VALID_ROOT,
          kickoff_at: 1_700_000_000_000 + i,
          generated_at: 1_700_000_000_100 + i,
        },
      });
    }
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("returns top operators ranked by best_bot_score desc", async () => {
    const { app } = await built;
    const res = await app.inject({ method: "GET", url: "/v1/swarms" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("s-maxage=60");
    const body = res.json();
    expect(body.operators).toHaveLength(3);
    expect(body.operators[0].best_bot_score).toBe(30);
    expect(body.operators[2].best_bot_score).toBe(10);
  });

  it("honours the limit query param", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/swarms?limit=2",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().operators).toHaveLength(2);
  });
});
