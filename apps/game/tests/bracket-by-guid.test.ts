/**
 * Tests for the share-guid persistence + public lookup endpoint.
 *
 * Covers the launch-blocking bug:
 *   - save endpoint persists a share guid and returns it
 *   - re-save with the same (user, tournament) keeps the SAME guid
 *   - `GET /v1/bracket/by-guid/<guid>` resolves the user's REAL
 *     bracket (champion code, locked_at, tournament id) and NOT a
 *     synthetic stub
 *   - 404 path for unknown guids
 *   - 409 conflict when a client supplies a guid already used by
 *     someone else
 */

import { afterAll, describe, expect, it } from "vitest";

import { makeBracket, makeMatchPrediction, makeServer } from "./helpers.js";

describe("game-service / share guid round-trip", () => {
  const built = makeServer();
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("mints a share_guid on first save and returns it in the receipt", async () => {
    const { app } = await built;
    const bracket = makeBracket("bk_share1", {
      "1": makeMatchPrediction("1", "home_win"),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_share1" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_share1",
        bracket,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.share_guid).toBe("string");
    expect(body.share_guid.length).toBeGreaterThanOrEqual(16);
  });

  it("preserves the share_guid across a re-save of the same bracket", async () => {
    const { app } = await built;
    const first = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_share2" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_share2",
        bracket: makeBracket("bk_share2", {
          "1": makeMatchPrediction("1", "home_win"),
        }),
      },
    });
    expect(first.statusCode).toBe(201);
    const firstGuid = first.json().share_guid;

    const second = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_share2" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_share2",
        bracket: makeBracket("bk_share2", {
          "1": makeMatchPrediction("1", "away_win"),
          "2": makeMatchPrediction("2", "home_win"),
        }),
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().share_guid).toBe(firstGuid);
  });

  it("accepts a client-supplied UUID v4 share_guid", async () => {
    const { app } = await built;
    const clientGuid = "00112233-4455-4677-8899-aabbccddeeff";
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_share3" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_share3",
        bracket: makeBracket("bk_share3", {
          "1": makeMatchPrediction("1", "home_win"),
        }),
        share_guid: clientGuid,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().share_guid).toBe(clientGuid);
  });

  it("rejects a share_guid already used by a different bracket with 409", async () => {
    const { app } = await built;
    const clientGuid = "11112222-3333-4444-8555-666677778888";
    const first = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_share_owner" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_share_owner",
        bracket: makeBracket("bk_share_owner", {
          "1": makeMatchPrediction("1", "home_win"),
        }),
        share_guid: clientGuid,
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_share_intruder" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_share_intruder",
        bracket: makeBracket("bk_share_intruder", {
          "1": makeMatchPrediction("1", "home_win"),
        }),
        share_guid: clientGuid,
      },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("share_guid_conflict");
  });

  it("GET /v1/bracket/by-guid/<guid> returns the saved bracket's champion (not a synthetic stub)", async () => {
    const { app } = await built;
    // Tim's bug scenario: save ARG as champion via a knockout pick
    // whose matchId encodes the codes ("final_ARG_FRA" → home wins).
    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_tim" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_tim",
        bracket: makeBracket(
          "bk_tim",
          {},
          {
            final_ARG_FRA: makeMatchPrediction("final_ARG_FRA", "home_win"),
            sf_ARG_BRA: makeMatchPrediction("sf_ARG_BRA", "home_win"),
            qf_ARG_NED: makeMatchPrediction("qf_ARG_NED", "home_win"),
            r16_ARG_AUS: makeMatchPrediction("r16_ARG_AUS", "home_win"),
            tp_BRA_CRO: makeMatchPrediction("tp_BRA_CRO", "home_win"),
          },
        ),
      },
    });
    expect(res.statusCode).toBe(201);
    const guid = res.json().share_guid;

    const lookup = await app.inject({
      method: "GET",
      url: `/v1/bracket/by-guid/${guid}`,
    });
    expect(lookup.statusCode).toBe(200);
    const body = lookup.json();
    expect(body.ok).toBe(true);
    expect(body.bracket.share_guid).toBe(guid);
    expect(body.bracket.tournament_id).toBe("fifa-wc-2026");
    expect(body.bracket.champion_code).toBe("ARG");
    expect(body.bracket.runner_up_code).toBe("FRA");
    expect(body.bracket.third_place_code).toBe("BRA");
    // 2026-05-25: knockout_path now surfaces 5 stages (r32 was added
    // for the FIFA WC 2026 48-team format). Legacy test data above
    // only provides r16+ picks so r32 is a TBD placeholder.
    expect(body.bracket.knockout_path.length).toBe(5);
    expect(body.bracket.knockout_path[4].stage).toBe("final");
    expect(body.bracket.knockout_path[4].opponent_code).toBe("FRA");
    expect(body.bracket.knockout_path[4].result).toBe("win");
    expect(lookup.headers["cache-control"]).toContain("public");
    expect(lookup.headers["cache-control"]).toContain("s-maxage=60");
  });

  it("GET /v1/bracket/by-guid/<guid> resolves the champion via the cascade for canonical knockout ids", async () => {
    // Tim's 2026-05-11 bug: brackets saved by the live web client use
    // canonical fixture ids ("r32_01", "qf_01", "final") instead of
    // ISO-encoded ids. The legacy regex extractor falls through every
    // one of those, surfacing TBD on the share page. The cascade-first
    // summariser resolves them properly.
    const { app } = await built;

    // Build a bracket where the user picks ARG to top group D (Argentina's
    // group in the 2026 fixtures) and picks the home (group-A winner)
    // through every knockout — that produces a concrete cascade winner.
    // We don't need to be precise about which team — we just need the
    // cascade to land *some* concrete champion code (non-null ISO).
    const matchPredictions: Record<string, { matchId: string; outcome: string; lockedAt: string }> = {};
    for (let n = 1; n <= 72; n += 1) {
      matchPredictions[String(n)] = {
        matchId: String(n),
        outcome: "home_win",
        lockedAt: "2026-06-01T00:00:00Z",
      };
    }
    const knockoutPredictions: Record<string, { matchId: string; outcome: string; lockedAt: string }> = {};
    for (let n = 1; n <= 16; n += 1) {
      knockoutPredictions[`r32_${String(n).padStart(2, "0")}`] = {
        matchId: `r32_${String(n).padStart(2, "0")}`,
        outcome: "home_win",
        lockedAt: "2026-06-01T00:00:00Z",
      };
    }
    for (let n = 1; n <= 8; n += 1) {
      knockoutPredictions[`r16_${String(n).padStart(2, "0")}`] = {
        matchId: `r16_${String(n).padStart(2, "0")}`,
        outcome: "home_win",
        lockedAt: "2026-06-01T00:00:00Z",
      };
    }
    for (let n = 1; n <= 4; n += 1) {
      knockoutPredictions[`qf_${String(n).padStart(2, "0")}`] = {
        matchId: `qf_${String(n).padStart(2, "0")}`,
        outcome: "home_win",
        lockedAt: "2026-06-01T00:00:00Z",
      };
    }
    for (let n = 1; n <= 2; n += 1) {
      knockoutPredictions[`sf_${String(n).padStart(2, "0")}`] = {
        matchId: `sf_${String(n).padStart(2, "0")}`,
        outcome: "home_win",
        lockedAt: "2026-06-01T00:00:00Z",
      };
    }
    knockoutPredictions["tp_01"] = {
      matchId: "tp_01",
      outcome: "home_win",
      lockedAt: "2026-06-01T00:00:00Z",
    };
    knockoutPredictions["final"] = {
      matchId: "final",
      outcome: "home_win",
      lockedAt: "2026-06-01T00:00:00Z",
    };

    const res = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_tim_canonical" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_tim_canonical",
        bracket: {
          bracketId: "bk_tim_canonical",
          matchPredictions,
          groupTiebreakers: {},
          knockoutPredictions,
          lockedAt: "2026-06-01T00:00:00Z",
          version: 2,
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const guid = res.json().share_guid;

    const lookup = await app.inject({
      method: "GET",
      url: `/v1/bracket/by-guid/${guid}`,
    });
    expect(lookup.statusCode).toBe(200);
    const body = lookup.json();
    expect(body.ok).toBe(true);
    // The exact code depends on the fixture set's group-A composition;
    // assert it's a real ISO-3 code (not null, not "TBD").
    expect(body.bracket.champion_code).toMatch(/^[A-Z]{3}$/);
    expect(body.bracket.runner_up_code).toMatch(/^[A-Z]{3}$/);
    // 2026-05-25: 5 stages (r32, r16, qf, sf, final) — see note above.
    expect(body.bracket.knockout_path.length).toBe(5);
    // Every opponent should be a real ISO-3 code, not null.
    for (const entry of body.bracket.knockout_path) {
      expect(entry.opponent_code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("GET /v1/bracket/by-guid/<guid>?include=payload requires owner auth (SEC-BRK-05)", async () => {
    const { app } = await built;
    const submit = await app.inject({
      method: "POST",
      url: "/v1/bracket/submit",
      headers: { "x-user-id": "u_payload" },
      payload: {
        tournament_id: "fifa-wc-2026",
        user_id: "u_payload",
        bracket: makeBracket("bk_payload", {
          "1": makeMatchPrediction("1", "home_win"),
          "2": makeMatchPrediction("2", "away_win"),
        }),
      },
    });
    expect(submit.statusCode).toBe(201);
    const guid = submit.json().share_guid;

    // Authenticated as the bracket owner → payload is included.
    const ownerLookup = await app.inject({
      method: "GET",
      url: `/v1/bracket/by-guid/${guid}?include=payload`,
      headers: { "x-user-id": "u_payload" },
    });
    expect(ownerLookup.statusCode).toBe(200);
    const ownerBody = ownerLookup.json();
    expect(ownerBody.ok).toBe(true);
    expect(ownerBody.bracket.payload).toBeTruthy();
    expect(ownerBody.bracket.payload.matchPredictions["1"].outcome).toBe("home_win");
    expect(ownerBody.bracket.payload.matchPredictions["2"].outcome).toBe("away_win");
    // SEC-BRK-05: owner-only payloads are never edge-cached.
    expect(ownerLookup.headers["cache-control"]).toContain("private");
    // SEC-BRK-05/06: never echo the raw user_id back to any caller.
    expect(ownerBody.bracket.user_id).toBeUndefined();

    // Unauthenticated caller requesting payload gets metadata only,
    // not the full bracket — public share URLs reveal the podium card
    // and knockout path, never the per-match picks.
    const anonLookup = await app.inject({
      method: "GET",
      url: `/v1/bracket/by-guid/${guid}?include=payload`,
    });
    expect(anonLookup.statusCode).toBe(200);
    expect(anonLookup.json().bracket.payload).toBeUndefined();

    // A DIFFERENT authenticated user is also denied the payload.
    const otherLookup = await app.inject({
      method: "GET",
      url: `/v1/bracket/by-guid/${guid}?include=payload`,
      headers: { "x-user-id": "u_intruder" },
    });
    expect(otherLookup.statusCode).toBe(200);
    expect(otherLookup.json().bracket.payload).toBeUndefined();

    // Without the include flag the payload is omitted (no auth).
    const naked = await app.inject({
      method: "GET",
      url: `/v1/bracket/by-guid/${guid}`,
    });
    expect(naked.statusCode).toBe(200);
    expect(naked.json().bracket.payload).toBeUndefined();
    expect(naked.json().bracket.user_id).toBeUndefined();
  });

  it("GET /v1/bracket/by-guid/<guid> returns 404 for an unknown guid", async () => {
    const { app } = await built;
    const res = await app.inject({
      method: "GET",
      url: "/v1/bracket/by-guid/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: "not_found" });
    // Still caches misses so we don't hammer the DB on a viral bad link.
    expect(res.headers["cache-control"]).toContain("public");
  });
});
