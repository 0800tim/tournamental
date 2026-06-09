/**
 * Server-side kickoff lockout enforcement.
 *
 * The bracket-submit handler must reject any prediction whose `lockedAt`
 * is at or after the match's published `kickoff_utc`. The submission as a
 * whole still succeeds — the rejected predictions are echoed back so the
 * client can show a per-match error and the kept predictions are
 * persisted.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  makeBracket,
  makeMatchPrediction,
  makeServer,
  makeStubRegistry,
} from "./helpers.js";

const TOURNAMENT = "fifa-wc-2026";
// Match "1" kicks off at 2026-06-11T19:00Z. Tests pin the clock at
// 2026-06-01T00:00Z (10 days earlier) so the submission is "now-valid";
// per-prediction lockedAt values control whether they pass or fail.
const KICKOFFS: Record<string, string> = {
  "1": "2026-06-11T19:00:00Z",
  "2": "2026-06-12T22:00:00Z",
  // Knockouts use string ids
  "r32_01": "2026-07-01T20:00:00Z",
};

describe("game-service / kickoff lockout", () => {
  const built = makeServer({
    kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
    // Pin "now" to a moment before all kickoffs so that the
    // server-side `lockedAt = now()` doesn't itself fail the rule.
    nowMs: () => Date.parse("2026-06-01T00:00:00Z"),
  });
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("SEC-BRK-02: a spoofed early lockedAt does NOT bypass the lock once the server clock is past kickoff", async () => {
    // The decision uses the SERVER clock, never the client's lockedAt.
    // Server now() is 5 minutes AFTER match 1's 19:00Z kickoff, but the
    // attacker sends a faked lockedAt of 18:00Z (before kickoff). Under
    // the old (spoofable) code this would have been accepted; now it is
    // rejected because the server clock says the match has started.
    const tamper = makeServer({
      kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
      nowMs: () => Date.parse("2026-06-11T19:05:00Z"),
    });
    const { app } = await tamper;
    try {
      const spoofedEarlyLockedAt = "2026-06-11T18:00:00Z";
      const bracket = makeBracket("bk_tamper", {
        "1": makeMatchPrediction("1", "home_win", {
          lockedAt: spoofedEarlyLockedAt,
        }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/bracket/submit",
        headers: { "x-user-id": "u_tamper" },
        payload: { tournament_id: TOURNAMENT, user_id: "u_tamper", bracket },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(Array.isArray(body.rejected)).toBe(true);
      expect(body.rejected).toHaveLength(1);
      expect(body.rejected[0].matchId).toBe("1");
      expect(body.rejected[0].error).toBe("match_already_started");
      // The match was rejected → not persisted, even with the spoof.
      const me = await app.inject({
        method: "GET",
        url: `/v1/bracket/me?tournament_id=${TOURNAMENT}`,
        headers: { "x-user-id": "u_tamper" },
      });
      expect(me.json().bracket?.matchPredictions?.["1"]).toBeUndefined();
    } finally {
      (await tamper).app.close();
    }
  });

  it("accepts a prediction whose lockedAt is 1 minute BEFORE kickoff", async () => {
    const { app } = await built;
    const earlyLockedAt = "2026-06-11T18:59:00Z";
    const bracket = makeBracket("bk_early", {
      "1": makeMatchPrediction("1", "draw", { lockedAt: earlyLockedAt }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_early" },
      payload: {
        tournament_id: TOURNAMENT,
        user_id: "u_early",
        bracket,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // No rejections → no `rejected` field on the receipt.
    expect(body.rejected).toBeUndefined();

    // The persisted bracket still contains the prediction.
    const me = await app.inject({
      method: "GET",
      url: `/v1/bracket/me?tournament_id=${TOURNAMENT}`,
      headers: { "x-user-id": "u_early" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().bracket.matchPredictions["1"]).toBeDefined();
  });

  it("echoes back rejected matches but still persists the others", async () => {
    // Server clock is 2026-06-12T00:00Z: AFTER match 1 (06-11 19:00) but
    // BEFORE match 2 (06-12 22:00) and all knockouts. So match 1 is
    // locked-out by the server clock; everything else is still open.
    const mixed = makeServer({
      kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
      nowMs: () => Date.parse("2026-06-12T00:00:00Z"),
    });
    const { app } = await mixed;
    try {
      const bracket = makeBracket(
        "bk_mixed",
        {
          "1": makeMatchPrediction("1", "home_win", {
            lockedAt: "2026-06-11T18:00:00Z",
          }),
          "2": makeMatchPrediction("2", "away_win", {
            lockedAt: "2026-06-12T00:00:00Z",
          }),
        },
        {
          r32_01: makeMatchPrediction("r32_01", "home_win", {
            lockedAt: "2026-06-12T00:00:00Z",
          }),
          r16_01: makeMatchPrediction("r16_01", "home_win", {
            lockedAt: "2026-06-12T00:00:00Z",
          }),
        },
      );
      const res = await app.inject({
        method: "POST",
        url: "/v1/bracket/submit",
        headers: { "x-user-id": "u_mixed" },
        payload: { tournament_id: TOURNAMENT, user_id: "u_mixed", bracket },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.rejected).toHaveLength(1);
      expect(body.rejected[0].matchId).toBe("1");

      const me = await app.inject({
        method: "GET",
        url: `/v1/bracket/me?tournament_id=${TOURNAMENT}`,
        headers: { "x-user-id": "u_mixed" },
      });
      expect(me.statusCode).toBe(200);
      const stored = me.json().bracket;
      // Match "1" kicked off on the server clock → rejected, not stored.
      expect(stored.matchPredictions["1"]).toBeUndefined();
      // Match "2" still open → stored.
      expect(stored.matchPredictions["2"]).toBeDefined();
      // Both knockout picks (one with kickoff, one without) → stored.
      expect(stored.knockoutPredictions["r32_01"]).toBeDefined();
      expect(stored.knockoutPredictions["r16_01"]).toBeDefined();
    } finally {
      (await mixed).app.close();
    }
  });

  it("treats unknown tournaments as no-kickoff (all predictions accepted)", async () => {
    const { app } = await built;
    const bracket = makeBracket("bk_unknown", {
      "1": makeMatchPrediction("1", "home_win", {
        lockedAt: "2030-01-01T00:00:00Z", // far in the future
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_unknown" },
      payload: {
        tournament_id: "some-other-tournament",
        user_id: "u_unknown",
        bracket,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().rejected).toBeUndefined();
  });

  // ---------- /v1/predictions/:matchId/check-lockable ----------

  it("check-lockable returns lockable=true when now < kickoff", async () => {
    const { app } = await built;
    // server `now` is pinned to 2026-06-01 (well before any kickoff)
    const res = await app.inject({
      method: "POST",
      url: "/v1/predictions/1/check-lockable",
      payload: { tournament_id: TOURNAMENT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lockable).toBe(true);
    expect(body.kickoff_utc).toBe("2026-06-11T19:00:00Z");
    expect(typeof body.now).toBe("string");
  });

  it("check-lockable returns lockable=false when now >= kickoff", async () => {
    const { app } = await built;
    // Build a fresh server with `now` pinned AFTER kickoff
    const built2 = await makeServer({
      kickoffs: makeStubRegistry(TOURNAMENT, KICKOFFS),
      nowMs: () => Date.parse("2026-06-12T00:00:00Z"),
    });
    try {
      const res = await built2.app.inject({
        method: "POST",
        url: "/v1/predictions/1/check-lockable",
        payload: { tournament_id: TOURNAMENT },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.lockable).toBe(false);
      expect(body.kickoff_utc).toBe("2026-06-11T19:00:00Z");
    } finally {
      await built2.app.close();
    }
  });

  it("check-lockable returns lockable=true with null kickoff for unknown matches", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/predictions/r16_01/check-lockable",
      payload: { tournament_id: TOURNAMENT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lockable).toBe(true);
    expect(body.kickoff_utc).toBeNull();
  });

  it("check-lockable rejects missing tournament_id with 400", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: "/v1/predictions/1/check-lockable",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("missing_tournament_id");
  });

  it("check-lockable accepts tournament_id from the query string", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "POST",
      url: `/v1/predictions/2/check-lockable?tournament_id=${TOURNAMENT}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kickoff_utc).toBe("2026-06-12T22:00:00Z");
  });
});
