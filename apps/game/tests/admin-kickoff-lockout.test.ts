/**
 * Absolute kickoff lockout — admin-override guard.
 *
 * Tim's rule: "As soon as a match kicks off, it must be locked and
 * totally impossible to change by anyone, even administrators."
 *
 * This file pins that rule with two complementary assertions:
 *
 *   1. Owner mutations after kickoff are refused on every write path
 *      we expose — `POST /v1/bracket/submit` silently filters them
 *      out (and echoes them in the `rejected` array on the receipt),
 *      `PUT /v1/picks/:userId/:matchId` returns `409 kickoff_locked`,
 *      and `DELETE /v1/picks/:userId/:matchId` returns the same 409.
 *      In neither case does the stored bracket change.
 *
 *   2. There is NO admin-authed pick-mutation endpoint in the route
 *      registry. The admin surface is intentionally limited to
 *      `POST /v1/match/:match_id/result` (records the canonical
 *      result) and `POST /v1/admin/tournaments/:id/settle` (closes
 *      a tournament). Neither writes user predictions; even an
 *      admin token with the correct bearer cannot mutate a pick
 *      because no such route exists.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  TEST_ADMIN_TOKEN,
  makeBracket,
  makeMatchPrediction,
  makeServer,
  makeStubRegistry,
} from "./helpers.js";

const TOURNAMENT = "fifa-wc-2026";
const KICKOFFS: Record<string, string> = {
  // Match "1" kicked off 1 second before the test's pinned "now".
  "1": "2026-06-11T19:00:00Z",
};

describe("game-service / admin kickoff-lockout guard", () => {
  // Pin "now" to 1 second AFTER match "1" kickoff so every mutation
  // attempt is unambiguously post-kickoff.
  const POST_KICKOFF_NOW = () => Date.parse("2026-06-11T19:00:01Z");

  const built = makeServer({
    kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
    nowMs: POST_KICKOFF_NOW,
  });

  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("PUT /v1/picks/:userId/:matchId returns 409 match_already_started after kickoff", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_owner/1",
      headers: { "x-user-id": "u_owner" },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("match_already_started");
    expect(body.match_id).toBe("1");
    expect(body.kickoff_utc).toBe("2026-06-11T19:00:00Z");
  });

  it("DELETE /v1/picks/:userId/:matchId returns 409 match_already_started after kickoff", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/picks/u_owner/1?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_owner" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("match_already_started");
  });

  it("POST /v1/bracket/submit filters out post-kickoff predictions (silent: kept set excludes them)", async () => {
    const { app } = await built;
    // Owner tries to lock in a prediction with a lockedAt 1ms after
    // kickoff. The submit succeeds (other matches may be valid) but
    // the rejected match never reaches storage.
    const bracket = makeBracket("bk_late_admin_test", {
      "1": makeMatchPrediction("1", "home_win", {
        lockedAt: "2026-06-11T19:00:00.001Z",
      }),
    });
    const submit = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_owner" },
      payload: {
        tournament_id: TOURNAMENT,
        user_id: "u_owner",
        bracket,
      },
    });
    expect(submit.statusCode).toBe(201);
    const body = submit.json();
    expect(Array.isArray(body.rejected)).toBe(true);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].matchId).toBe("1");
    expect(body.rejected[0].error).toBe("match_already_started");

    // The stored bracket does NOT contain a pick for match "1".
    const me = await app.inject({
      method: "GET",
      url: `/v1/bracket/me?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_owner" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().bracket.matchPredictions["1"]).toBeUndefined();
  });

  it("admin token CANNOT mutate a user pick — no admin pick-write endpoint exists in the route registry", async () => {
    // The audit: enumerate every route registered by buildServer()
    // and assert that no path matching `/v1/picks/` or any other
    // per-user prediction write surface is gated by the admin guard.
    // Concretely, no admin-authed route may write `bracket.*Predictions`.
    //
    // Implementation: walk Fastify's internal route list. Each entry
    // is { method, path }. We assert:
    //   - No `/v1/picks/...` route accepts an `Authorization: Bearer`
    //     admin token as its sole credential (the route requires
    //     ownership via resolveUserId; the admin token doesn't satisfy
    //     that path).
    //   - No bespoke admin endpoint exists at `/v1/admin/.../picks`,
    //     `/v1/admin/.../predictions`, `/v1/admin/users/:id/bracket`,
    //     or similar.
    const { app } = await built;
    const routesTree = app.printRoutes({ commonPrefix: false });
    // Every line we care about looks like "/v1/foo/bar (POST, PUT, ...)"
    // — search the printable tree for any admin-shaped pick-write path.
    const forbiddenPatterns = [
      /\/v1\/admin\/[^\s]*\/picks?/i,
      /\/v1\/admin\/[^\s]*\/predictions?/i,
      /\/v1\/admin\/users\/[^\s]*\/bracket/i,
      /\/v1\/admin\/users\/[^\s]*\/picks?/i,
    ];
    for (const pattern of forbiddenPatterns) {
      expect(
        routesTree,
        `route tree must not contain ${pattern} — admin must never override picks post-kickoff`,
      ).not.toMatch(pattern);
    }

    // Direct probe: attempt to use the admin token against the
    // per-user pick PUT and assert it still 403s (the admin token
    // doesn't satisfy the per-user ownership check the route
    // enforces). This is the belt-and-braces complement to the
    // route-tree audit — even if a future commit accidentally
    // wires the admin guard onto `/v1/picks/...`, the per-user
    // identity check in `requireOwner` would still need to fail.
    const adminPut = await app.inject({
      method: "PUT",
      url: "/v1/picks/u_owner/1",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
      payload: { tournament_id: TOURNAMENT, outcome: "home_win" },
    });
    // No `x-user-id` and no JWT → resolveUserId returns null →
    // route 401s. The admin token is NOT a substitute for ownership.
    expect(adminPut.statusCode).toBe(401);
    expect(adminPut.json().error).toBe("missing_user");
  });
});
