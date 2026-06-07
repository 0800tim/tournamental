/**
 * GET /v1/leaderboard/:tournament_id?scope=humans|bots|all
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeServer } from "./helpers.js";
import { _resetBotArenaCache } from "../src/routes/leaderboard.js";

describe("GET /v1/leaderboard?scope=...", () => {
  const built = makeServer({ cacheTtlMs: 50 });

  beforeAll(async () => {
    _resetBotArenaCache();
    const { store } = await built;
    const now = Date.now();
    for (const [id, is_bot, score] of [
      ["u_h1", 0, 50],
      ["u_h2", 0, 40],
      ["u_h3", 0, 30],
      ["bot_b1", 1, 70],
      ["bot_b2", 1, 60],
    ] as Array<[string, 0 | 1, number]>) {
      store.db
        .prepare(
          `INSERT INTO users (id, created_at, is_bot) VALUES (?, ?, ?)`,
        )
        .run(id, now, is_bot);
      store.db
        .prepare(
          `INSERT INTO brackets
             (id, user_id, tournament_id, payload_json, locked_at,
              score_total, share_guid)
           VALUES (?, ?, 'fifa-wc-2026', '{}', ?, ?, ?)`,
        )
        .run(`${id}_b`, id, now, score, id.slice(0, 8));
    }
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("scope=humans returns only is_bot=0 users", async () => {
    const { app } = await built;
    _resetBotArenaCache();
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026?scope=humans",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scope).toBe("humans");
    expect(body.rows.length).toBe(3);
  });

  it("scope=bots returns only is_bot=1 users", async () => {
    const { app } = await built;
    _resetBotArenaCache();
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026?scope=bots",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scope).toBe("bots");
    expect(body.rows.length).toBe(2);
  });

  it("scope=all returns everyone", async () => {
    const { app } = await built;
    _resetBotArenaCache();
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026?scope=all",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scope).toBe("all");
    expect(body.rows.length).toBe(5);
  });

  it("no scope preserves the legacy unfiltered response shape", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scope).toBeUndefined();
    expect(body.rows.length).toBe(5);
  });

  it("source=federated returns the federated aggregate (empty by default)", async () => {
    const { app } = await built;
    _resetBotArenaCache();
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026?source=federated",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("federated");
    expect(Array.isArray(body.rows)).toBe(true);
  });
});
