import { afterAll, describe, expect, it } from "vitest";

import { makeBracket, makeMatchPrediction, makeServer } from "./helpers.js";

describe("game-service / bracket submit + retrieve", () => {
  const built = makeServer();
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("rejects an unauthenticated POST with 401 missing_user (SEC-BRK-01)", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("missing_user");
  });

  it("rejects an empty body with 400 invalid_payload (when authenticated)", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_1" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_payload");
    expect(Array.isArray(res.json().issues)).toBe(true);
  });

  it("rejects a malformed bracket (missing bracketId) with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_1" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_1",
        bracket: {
          // missing bracketId
          matchPredictions: {},
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_payload");
  });

  it("rejects an invalid outcome with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_1" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_1",
        bracket: {
          bracketId: "bk_1",
          matchPredictions: {
            "1": {
              matchId: "1",
              outcome: "totally_invalid",
              lockedAt: "2026-06-01T00:00:00Z",
            },
          },
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a body whose user_id != caller id with 403 (SEC-BRK-01)", async () => {
    const { app } = await built;
    const bracket = makeBracket("bk_mismatch", {
      "1": makeMatchPrediction("1", "home_win"),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_attacker" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_victim",
        bracket,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("user_mismatch");
  });

  it("accepts a valid bracket and returns 201 + a lock receipt", async () => {
    const { app } = await built;
    const bracket = makeBracket("bk_alpha", {
      "1": makeMatchPrediction("1", "home_win"),
      "2": makeMatchPrediction("2", "draw"),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_alpha" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_alpha",
        bracket,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bracket_id).toBe("bk_alpha");
    expect(body.user_id).toBe("u_alpha");
    expect(body.tournament_id).toBe("fifa-wc-2026");
    expect(typeof body.locked_at).toBe("string");
    expect(body.version).toBe(1);
    expect(res.headers["cache-control"]).toContain("private");
  });

  it("re-submission returns 200 and replaces the prior bracket", async () => {
    const { app } = await built;
    const bracket = makeBracket("bk_beta-old", {
      "5": makeMatchPrediction("5", "home_win"),
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_beta" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_beta",
        bracket,
      },
    });
    expect(first.statusCode).toBe(201);

    const updated = makeBracket("bk_beta-new", {
      "5": makeMatchPrediction("5", "draw"),
      "6": makeMatchPrediction("6", "away_win"),
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_beta" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_beta",
        bracket: updated,
      },
    });
    expect(second.statusCode).toBe(200);
    // The bracket id stays as the *original* row id — the service merges
    // by (user, tournament).
    const body = second.json();
    expect(body.user_id).toBe("u_beta");
  });

  it("GET /v1/bracket/me requires X-User-Id header", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/bracket/me requires tournament_id query", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/bracket/me",
      headers: { "x-user-id": "u_alpha" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/bracket/me returns 404 for an unknown user", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_nobody" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/bracket/me returns the locked bracket for the user", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_alpha" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bracket.bracketId).toBe("bk_alpha");
    expect(body.user_id).toBe("u_alpha");
    expect(body.score_total).toBe(0);
    expect(typeof body.locked_at).toBe("string");
    expect(res.headers["cache-control"]).toContain("private");
  });

  it("user_id can also come from a query param", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026&user_id=u_alpha",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user_id).toBe("u_alpha");
  });
});
