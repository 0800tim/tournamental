/**
 * Per-match pick endpoints.
 *
 *   PUT    /v1/picks/:userId/:matchId
 *   GET    /v1/picks/:userId/:matchId
 *   DELETE /v1/picks/:userId/:matchId
 *
 * Covers:
 *   - PUT validates outcome by stage (knockout + draw → 422)
 *   - PUT respects kickoff lockout (now ≥ kickoff → 409)
 *   - PUT idempotency (same body twice → same persisted pick, both 200)
 *   - GET 404 when no pick
 *   - DELETE then GET = 404
 *   - Auth: missing X-User-Id → 401, mismatched → 403
 *   - Per-user-per-match rate limit triggers on the 11th rapid request
 *   - PUT propagates oddsAtLock if supplied
 *   - PUT and bulk submit interoperate (pick survives a re-read via
 *     /v1/bracket/me)
 */

import { afterAll, describe, expect, it } from "vitest";

import { makeServer, makeStubRegistry } from "./helpers.js";
import { PerMatchRateLimiter } from "../src/routes/picks.js";

const TOURNAMENT = "fifa-wc-2026";
const KICKOFFS: Record<string, string> = {
  "1": "2026-06-11T19:00:00Z",
  "2": "2026-06-12T22:00:00Z",
  r32_01: "2026-07-01T20:00:00Z",
};
const FIXED_NOW = () => Date.parse("2026-06-01T00:00:00Z");

describe("game-service / per-match picks", () => {
  const built = makeServer({
    kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
    nowMs: FIXED_NOW,
  });
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("PUT requires X-User-Id", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_a/1",
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("missing_user");
  });

  it("PUT 403s when caller-id != path-id (cross-user write attempt)", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_a/1",
      headers: { "x-user-id": "u_attacker" },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("user_mismatch");
  });

  it("PUT accepts a valid group-stage pick and returns the saved shape", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_alpha/1",
      headers: { "x-user-id": "u_alpha" },
      payload: {
        tournament_id: TOURNAMENT,
        outcome: "home_win",
        homeScore: 2,
        awayScore: 1,
        oddsAtLock: {
          homeWin: 0.5,
          draw: 0.25,
          awayWin: 0.25,
          source: "polymarket",
          capturedAt: "2026-06-01T00:00:00Z",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pick.matchId).toBe("1");
    expect(body.pick.outcome).toBe("home_win");
    expect(body.pick.homeScore).toBe(2);
    expect(body.pick.awayScore).toBe(1);
    expect(typeof body.pick.lockedAt).toBe("string");
    expect(body.pick.oddsAtLock?.source).toBe("polymarket");
    expect(body.stage).toBe("group");
    expect(body.cascade_refresh_hint).toBe(false);
    expect(res.headers["cache-control"]).toContain("private");
  });

  it("GET returns the saved pick", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/picks/u_alpha/1?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_alpha" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pick.outcome).toBe("home_win");
    expect(body.kickoff_utc).toBe("2026-06-11T19:00:00Z");
    expect(body.stage).toBe("group");
  });

  it("PUT is idempotent: same body twice => same outcome, both 200", async () => {
    const { app } = await built;
    const payload = {
      tournament_id: TOURNAMENT,
      outcome: "draw" as const,
    };
    const first = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_idem/2",
      headers: { "x-user-id": "u_idem" },
      payload,
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_idem/2",
      headers: { "x-user-id": "u_idem" },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(first.json().pick.outcome).toBe(second.json().pick.outcome);
    // bracketId stays stable across re-PUT
    expect(first.json().bracket_id).toBe(second.json().bracket_id);
  });

  it("PUT 422s when knockout match given outcome=draw", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_beta/r32_01",
      headers: { "x-user-id": "u_beta" },
      payload: { tournament_id: TOURNAMENT, outcome: "draw" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("outcome_not_allowed_for_stage");
    expect(res.json().stage).toBe("r32");
  });

  it("PUT accepts knockout pick when outcome is home_win or away_win", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_beta/r32_01",
      headers: { "x-user-id": "u_beta" },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("r32");
    expect(res.json().cascade_refresh_hint).toBe(true);
  });

  it("PUT 409s when match has already kicked off", async () => {
    const { app } = await built;
    const builtLate = await makeServer({
      kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
      // Pin the clock 1ms after kickoff for match "1".
      nowMs: () => Date.parse("2026-06-11T19:00:00.001Z"),
    });
    const res = await builtLate.app.inject({
      method: "PUT",
      url: "/v1/picks/u_late/1",
      headers: { "x-user-id": "u_late" },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    await builtLate.app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("match_already_started");
    expect(res.json().kickoff_utc).toBe("2026-06-11T19:00:00Z");
  });

  it("DELETE removes the pick; subsequent GET returns 404", async () => {
    const { app } = await built;
    // Seed a pick first.
    const put = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_gamma/2",
      headers: { "x-user-id": "u_gamma" },
      payload: { tournament_id: TOURNAMENT, outcome: "away_win" },
    });
    expect(put.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE",
      url: `/v1/picks/u_gamma/2?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_gamma" },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().removed).toBe(true);

    const get = await app.inject({
      method: "GET",
      url: `/v1/picks/u_gamma/2?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_gamma" },
    });
    expect(get.statusCode).toBe(404);
  });

  it("GET returns 404 when the user has no pick saved", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: `/v1/picks/u_unseeded/1?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_unseeded" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("DELETE on a never-picked match returns 404 (the row exists but matchId doesn't)", async () => {
    const { app } = await built;
    // Seed a different pick so a bracket row exists.
    await app.inject({
      method: "PUT",
      url: "/v1/picks/u_delta/1",
      headers: { "x-user-id": "u_delta" },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/picks/u_delta/2?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_delta" },
    });
    expect(del.statusCode).toBe(404);
    expect(del.json().error).toBe("not_found");
  });

  it("the saved pick shows up in the bulk GET /v1/bracket/me", async () => {
    const { app } = await built;
    await app.inject({
      method: "PUT",
      url: "/v1/picks/u_blend/1",
      headers: { "x-user-id": "u_blend" },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    const me = await app.inject({
      method: "GET",
      url: `/v1/bracket/me?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_blend" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().bracket.matchPredictions["1"].outcome).toBe("home_win");
  });
});

describe("game-service / per-match pick rate limit", () => {
  it("triggers a 429 on the 11th rapid PUT for the same (user, match)", async () => {
    // We construct a one-off server with a known limiter so we can
    // observe its behaviour without leaking state into the shared suite.
    const limiter = new PerMatchRateLimiter(10, 60_000);
    const built = await makeServer({
      kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
      nowMs: FIXED_NOW,
    });
    // Replace the default limiter inside the registered route by
    // re-registering with our stub. Since the route is already
    // attached, we spin up a second server for the rate-limit test.
    await built.app.close();

    const { app } = await makeServer({
      kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
      nowMs: FIXED_NOW,
    });
    // Hitting the same (user, match) repeatedly. The default limiter
    // is constructed inside the picks route at 10/min, so we expect
    // the 11th call to 429.
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: "PUT",
        url: "/v1/picks/u_rl/1",
        headers: { "x-user-id": "u_rl" },
        payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
      });
      last = res.statusCode;
      if (i < 10) {
        expect(res.statusCode).toBe(200);
      }
    }
    expect(last).toBe(429);
    await app.close();
    // Touch the limiter so it stays in scope (unused-var lint friendly).
    expect(limiter).toBeDefined();
  });
});
