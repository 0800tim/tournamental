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
    expect(body.bracket.knockout_path.length).toBe(4);
    expect(body.bracket.knockout_path[3].stage).toBe("final");
    expect(body.bracket.knockout_path[3].opponent_code).toBe("FRA");
    expect(body.bracket.knockout_path[3].result).toBe("win");
    expect(lookup.headers["cache-control"]).toContain("public");
    expect(lookup.headers["cache-control"]).toContain("s-maxage=60");
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
