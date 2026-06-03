import { afterAll, describe, expect, it } from "vitest";

import {
  TEST_ADMIN_TOKEN,
  makeBracket,
  makeMatchPrediction,
  makeServer,
} from "./helpers.js";

describe("game-service / leaderboard", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  async function submit(userId: string, bracketId: string, pick: "home_win" | "draw" | "away_win") {
    const { app } = await built;
    const bracket = makeBracket(bracketId, {
      "20": makeMatchPrediction("20", pick),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": userId },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: userId,
        bracket,
      },
    });
    expect(res.statusCode).toBe(201);
  }

  it("seeds three users with three distinct picks", async () => {
    await submit("u_lb_1", "bk_lb_1", "home_win");
    await submit("u_lb_2", "bk_lb_2", "home_win");
    await submit("u_lb_3", "bk_lb_3", "draw");
  });

  it("global leaderboard returns 0-score rows before any settlement", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tournament_id).toBe("fifa-wc-2026");
    expect(body.rows.length).toBeGreaterThanOrEqual(3);
    expect(body.rows.every((r: { score_total: number }) => r.score_total === 0)).toBe(true);
    // Every row carries the public-share token so the leaderboard can
    // deep-link to the public-profile page (`/u/<share_guid>`).
    expect(
      body.rows.every((r: { share_guid: string | null }) =>
        typeof r.share_guid === "string" && r.share_guid.length > 0,
      ),
    ).toBe(true);
    // bracket_id must be a concrete string (regression: a prior alias
    // bug left this `undefined` on every row).
    expect(
      body.rows.every((r: { bracket_id: string }) =>
        typeof r.bracket_id === "string" && r.bracket_id.length > 0,
      ),
    ).toBe(true);
    expect(res.headers["cache-control"]).toContain("public");
    expect(res.headers["cache-control"]).toContain("max-age=30");
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("a second call within the TTL is a cache hit", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
  });

  it("recording a result invalidates the cache", async () => {
    const { app } = await built;
    const post = await app.inject({
      method: "POST",
      url: "/v1/match/20/result",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "home_win",
        stage: "group",
        impliedAtLock: 0.4,
        secondsSinceLock: 0,
        windowSeconds: 30 * 24 * 60 * 60,
      },
    });
    expect(post.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    const body = res.json();
    // Top row is one of the two correct pickers (positive score).
    expect(body.rows[0].score_total).toBeGreaterThan(0);
    expect(body.rows[0].rank).toBe(1);
    // Bottom rows include the wrong-picker with 0.
    const totals = body.rows.map((r: { score_total: number }) => r.score_total);
    expect(Math.min(...totals)).toBe(0);
    // Sorted descending.
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i - 1]).toBeGreaterThanOrEqual(totals[i]);
    }
  });

  it("rejects an empty tournament_id with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/%20",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("game-service / syndicate leaderboard", () => {
  const built = makeServer({ cacheTtlMs: 50 });
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  async function submit(userId: string, pick: "home_win" | "draw" | "away_win") {
    const { app } = await built;
    const bracket = makeBracket(`bk_${userId}`, {
      "30": makeMatchPrediction("30", pick),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": userId },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: userId,
        bracket,
      },
    });
    expect(res.statusCode).toBe(201);
  }

  async function joinSyndicate(userId: string, syndicateId: string) {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/syndicate/join",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: { user_id: userId, syndicate_id: syndicateId },
    });
    expect(res.statusCode).toBe(200);
  }

  it("seeds users into two syndicates", async () => {
    await submit("u_s1_a", "home_win");
    await submit("u_s1_b", "draw");
    await submit("u_s2_a", "away_win");
    await joinSyndicate("u_s1_a", "syn-alpha");
    await joinSyndicate("u_s1_b", "syn-alpha");
    await joinSyndicate("u_s2_a", "syn-beta");
  });

  it("syndicate leaderboard only includes its own members", async () => {
    const { app } = await built;
    // settle match 30 → home_win so u_s1_a is the only correct picker
    const post = await app.inject({
      method: "POST",
      url: "/v1/match/30/result",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: {
        tournament_id: "fifa-wc-2026",
        outcome: "home_win",
        stage: "group",
        impliedAtLock: 0.4,
        secondsSinceLock: 0,
        windowSeconds: 30 * 24 * 60 * 60,
      },
    });
    expect(post.statusCode).toBe(200);

    const alpha = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026/syndicate/syn-alpha",
    });
    expect(alpha.statusCode).toBe(200);
    const alphaBody = alpha.json();
    expect(alphaBody.syndicate_id).toBe("syn-alpha");
    expect(alphaBody.rows.length).toBe(2);
    // SEC-BRK-06: public leaderboard surface emits an opaque
    // `user_handle` (8-char HMAC) instead of `user_id`. We assert
    // shape + score ordering only — the test no longer round-trips
    // the raw user id through this endpoint.
    expect(
      alphaBody.rows.every((r: { user_id?: string }) => r.user_id === undefined),
    ).toBe(true);
    expect(
      alphaBody.rows.every((r: { user_handle: string }) =>
        /^[0-9a-f]{8}$/.test(r.user_handle),
      ),
    ).toBe(true);
    // Top row is the correct picker; the other syn-alpha member is 0.
    expect(alphaBody.rows[0].score_total).toBeGreaterThan(0);
    expect(alphaBody.rows[1].score_total).toBe(0);

    const beta = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026/syndicate/syn-beta",
    });
    expect(beta.statusCode).toBe(200);
    const betaBody = beta.json();
    expect(betaBody.rows.length).toBe(1);
    expect(betaBody.rows[0].user_id).toBeUndefined();
    expect(/^[0-9a-f]{8}$/.test(betaBody.rows[0].user_handle)).toBe(true);
  });

  it("unknown syndicate returns an empty list, not an error", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/leaderboard/fifa-wc-2026/syndicate/syn-does-not-exist",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([]);
  });
});
