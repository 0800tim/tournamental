/**
 * POST /v1/picks/bulk , Bot Arena swarm submission endpoint.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §7
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeServer } from "./helpers.js";

describe("POST /v1/picks/bulk", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  let apiKey = "";
  let apiKeyHash = "";

  beforeAll(async () => {
    const { store } = await built;
    const issued = store.apiKeys.issue({
      owner_email: "dev@example.com",
      label: "swarm-01",
    });
    apiKey = issued.api_key;
    apiKeyHash = issued.key_hash;
    // Seed two owned bots + one un-owned bot.
    for (const id of ["bot_a", "bot_b"] as const) {
      store.db
        .prepare(
          `INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`,
        )
        .run(id);
      store.botOwners.claim({
        bot_id: id,
        api_key_hash: apiKeyHash,
        owner_email: "dev@example.com",
      });
    }
    store.db
      .prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`)
      .run("bot_unowned");
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("accepts a small bulk payload and reports accepted count", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          {
            bot_id: "bot_a",
            picks: [
              { match_id: "1", outcome: "home_win" },
              { match_id: "2", outcome: "draw" },
            ],
          },
          {
            bot_id: "bot_b",
            picks: [{ match_id: "1", outcome: "away_win" }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(3);
    expect(body.dropped_picks).toEqual([]);
    expect(body.quota_remaining.picks_per_hour).toBe(100_000 - 3);
  });

  it("upserts on a second submission for the same bot", async () => {
    const { app, store } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          {
            bot_id: "bot_a",
            picks: [{ match_id: "1", outcome: "away_win" }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const row = store.getBracketForUser("bot_a", "fifa-wc-2026");
    expect(row).not.toBeNull();
    const payload = JSON.parse(row!.payload_json) as {
      matchPredictions: Record<string, { outcome: string }>;
    };
    expect(payload.matchPredictions["1"]?.outcome).toBe("away_win");
  });

  it("rejects bots the API key does not own with 403 not_owner", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          {
            bot_id: "bot_unowned",
            picks: [{ match_id: "1", outcome: "home_win" }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_owner");
  });

  it("rejects unknown bot_id with 403 not_owner", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          {
            bot_id: "bot_does_not_exist",
            picks: [{ match_id: "1", outcome: "home_win" }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_owner");
  });

  it("rejects payloads over 10,000 picks with 413", async () => {
    const { app } = await built;
    const picks = Array.from({ length: 5_001 }, (_, i) => ({
      match_id: String((i % 96) + 1),
      outcome: "home_win" as const,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          { bot_id: "bot_a", picks },
          { bot_id: "bot_b", picks },
        ],
      },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe("batch_too_large");
  });

  it("rejects requests without a valid API key with 401", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [
          {
            bot_id: "bot_a",
            picks: [{ match_id: "1", outcome: "home_win" }],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("missing_api_key");
  });

  it("rejects a forged API key with 401", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: "Bearer tnm_not_a_real_key_xxxxxxxxxxxxxxx" },
      payload: { tournament_id: "fifa-wc-2026", submissions: [] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_api_key");
  });

  it("rejects malformed payloads with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/picks/bulk",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        submissions: [{ bot_id: "bot_a", picks: [] }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_payload");
  });
});
