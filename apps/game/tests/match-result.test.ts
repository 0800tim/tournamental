import { afterAll, describe, expect, it } from "vitest";

import {
  TEST_ADMIN_TOKEN,
  makeBracket,
  makeMatchPrediction,
  makeServer,
} from "./helpers.js";

describe("game-service / match result + scoring", () => {
  const built = makeServer();
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  // Submit two brackets up-front so the result-recompute has someone to score.
  it("seeds two brackets for the tournament", async () => {
    const { app } = await built;

    const aliceBracket = makeBracket("bk_alice", {
      "11": makeMatchPrediction("11", "home_win", { homeScore: 2, awayScore: 1 }),
      "12": makeMatchPrediction("12", "away_win"),
    });
    const aliceRes = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_alice" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_alice",
        bracket: aliceBracket,
      },
    });
    expect(aliceRes.statusCode).toBe(201);

    const bobBracket = makeBracket("bk_bob", {
      "11": makeMatchPrediction("11", "draw"),
      "12": makeMatchPrediction("12", "away_win"),
    });
    const bobRes = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_bob" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_bob",
        bracket: bobBracket,
      },
    });
    expect(bobRes.statusCode).toBe(201);
  });

  it("rejects an unauthenticated admin POST with 401", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/match/11/result",
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "home_win",
        impliedAtLock: 0.5,
        secondsSinceLock: 0,
        windowSeconds: 86400,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("missing_bearer");
  });

  it("rejects a wrong bearer token with 403", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/match/11/result",
      headers: { authorization: "Bearer wrong-token" },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "home_win",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("bad_token");
  });

  it("rejects a malformed body with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/match/11/result",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "not-a-real-outcome",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_payload");
  });

  it("records a match result and re-scores affected brackets", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/match/11/result",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "home_win",
        homeScore: 2,
        awayScore: 1,
        stage: "group",
        impliedAtLock: 0.5,
        secondsSinceLock: 0,
        windowSeconds: 30 * 24 * 60 * 60,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.match_id).toBe("11");
    expect(body.tournament_id).toBe("fifa-wc-2026");
    // Both Alice and Bob have predictions on match 11, so both rescore.
    expect(body.rescored_brackets).toBe(2);
  });

  it("Alice (correct outcome + exact score) ranks above Bob (wrong outcome)", async () => {
    const { app } = await built;
    const aliceRes = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_alice" },
    });
    const bobRes = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_bob" },
    });
    expect(aliceRes.statusCode).toBe(200);
    expect(bobRes.statusCode).toBe(200);
    const aliceTotal = aliceRes.json().score_total;
    const bobTotal = bobRes.json().score_total;
    // Alice predicted home_win 2-1 against an actual home_win 2-1 — base
    // points 50 (outcome) + 200 (exact score) = 250, multiplied by lock
    // and contrarian multipliers. Bob predicted draw — wrong outcome,
    // zero points.
    expect(aliceTotal).toBeGreaterThan(0);
    expect(bobTotal).toBe(0);
    expect(aliceTotal).toBeGreaterThan(bobTotal);
  });

  it("recording a second match result accumulates points across both", async () => {
    const { app } = await built;
    const before = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_alice" },
    });
    const aliceBefore = before.json().score_total;

    const res = await app.inject({
      method: "POST",
      url: "/v1/match/12/result",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "away_win",
        homeScore: 0,
        awayScore: 3,
        stage: "group",
        impliedAtLock: 0.5,
        secondsSinceLock: 0,
        windowSeconds: 30 * 24 * 60 * 60,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rescored_brackets).toBe(2);

    const after = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_alice" },
    });
    const bobAfter = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_bob" },
    });
    const aliceAfter = after.json().score_total;
    expect(aliceAfter).toBeGreaterThan(aliceBefore);
    // Bob picked match 12 correctly; he should now be > 0.
    expect(bobAfter.json().score_total).toBeGreaterThan(0);
  });

  it("re-recording the same match result is idempotent", async () => {
    const { app } = await built;
    const before = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_alice" },
    });
    const aliceBefore = before.json().score_total;

    const res = await app.inject({
      method: "POST",
      url: "/v1/match/11/result",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "home_win",
        homeScore: 2,
        awayScore: 1,
        stage: "group",
        impliedAtLock: 0.5,
        secondsSinceLock: 0,
        windowSeconds: 30 * 24 * 60 * 60,
      },
    });
    expect(res.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/v1/bracket/me?tournament_id=fifa-wc-2026",
      headers: { "x-user-id": "u_alice" },
    });
    expect(after.json().score_total).toBe(aliceBefore);
  });
});

describe("game-service / admin disabled when no token configured", () => {
  const built = makeServer({ adminToken: null });
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("returns 503 admin_disabled when GAME_ADMIN_TOKEN is empty", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/match/X/result",
      headers: { authorization: "Bearer anything" },
      payload: { tournament_id: "fifa-wc-2026", outcome: "home_win" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("admin_disabled");
  });
});
