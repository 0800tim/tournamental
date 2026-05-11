/**
 * Tests for `lib/bracket/api.ts` — the thin fetch wrapper around the
 * game-service endpoints. We mock fetch and assert on the URL, headers,
 * body, and response shape mapping.
 */

import { describe, expect, it, vi } from "vitest";

import {
  loadServerBracket,
  savePerMatchPick,
  saveFullBracket,
} from "../lib/bracket/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("savePerMatchPick", () => {
  it("PUTs to /v1/picks/:userId/:matchId with X-User-Id + JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        pick: {
          matchId: "42",
          outcome: "home_win",
          lockedAt: "2026-06-01T00:00:00.000Z",
        },
        bracket_id: "bk_u_1_fifa-wc-2026_42",
        tournament_id: "fifa-wc-2026",
        stage: "group",
        cascade_refresh_hint: false,
      }),
    );

    const res = await savePerMatchPick(
      {
        userId: "u_1",
        matchId: "42",
        tournamentId: "fifa-wc-2026",
        outcome: "home_win",
        homeScore: 2,
        awayScore: 1,
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bracketId).toBe("bk_u_1_fifa-wc-2026_42");
    expect(res.stage).toBe("group");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://t.invalid/v1/picks/u_1/42");
    const reqInit = init as RequestInit;
    expect(reqInit.method).toBe("PUT");
    const headers = reqInit.headers as Record<string, string>;
    expect(headers["x-user-id"]).toBe("u_1");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(reqInit.body as string)).toEqual({
      tournament_id: "fifa-wc-2026",
      outcome: "home_win",
      homeScore: 2,
      awayScore: 1,
    });
  });

  it("returns ok:false with the server error code on 409", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        error: "match_already_started",
        match_id: "42",
        kickoff_utc: "2026-06-12T00:00:00Z",
      }),
    );
    const res = await savePerMatchPick(
      {
        userId: "u_1",
        matchId: "42",
        tournamentId: "fifa-wc-2026",
        outcome: "home_win",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("match_already_started");
    expect(res.status).toBe(409);
  });

  it("returns ok:false code:network_error on transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await savePerMatchPick(
      {
        userId: "u_1",
        matchId: "42",
        tournamentId: "fifa-wc-2026",
        outcome: "home_win",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("network_error");
  });
});

describe("saveFullBracket", () => {
  it("POSTs to /v1/bracket/submit and returns the lock receipt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        bracket_id: "bk_abc",
        user_id: "u_1",
        tournament_id: "fifa-wc-2026",
        locked_at: "2026-06-01T00:00:00.000Z",
        version: 1,
      }),
    );
    const res = await saveFullBracket(
      {
        userId: "u_1",
        tournamentId: "fifa-wc-2026",
        bracket: {
          bracketId: "bk_local",
          matchPredictions: {},
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bracketId).toBe("bk_abc");
    expect(res.lockedAt).toBe("2026-06-01T00:00:00.000Z");

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://t.invalid/v1/bracket/submit");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-user-id"]).toBe("u_1");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      tournament_id: "fifa-wc-2026",
      user_id: "u_1",
    });
  });

  it("surfaces rejected predictions returned by the server", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        bracket_id: "bk_abc",
        user_id: "u_1",
        tournament_id: "fifa-wc-2026",
        locked_at: "2026-06-01T00:00:00.000Z",
        version: 1,
        rejected: [
          {
            matchId: "1",
            error: "match_already_started",
            kickoff_utc: "2026-06-11T00:00:00Z",
            lockedAt: "2026-06-12T00:00:00Z",
          },
        ],
      }),
    );
    const res = await saveFullBracket(
      {
        userId: "u_1",
        tournamentId: "fifa-wc-2026",
        bracket: {
          bracketId: "bk_local",
          matchPredictions: {},
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        },
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected?.[0]?.matchId).toBe("1");
  });
});

describe("loadServerBracket", () => {
  it("GETs /v1/bracket/me?tournament_id=... with X-User-Id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        bracket_id: "bk_abc",
        user_id: "u_1",
        tournament_id: "fifa-wc-2026",
        locked_at: "2026-06-01T00:00:00.000Z",
        score_total: 0,
        bracket: {
          bracketId: "bk_abc",
          matchPredictions: {
            "1": {
              matchId: "1",
              outcome: "home_win",
              lockedAt: "2026-06-01T00:00:00.000Z",
            },
          },
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        },
      }),
    );
    const res = await loadServerBracket(
      { userId: "u_1", tournamentId: "fifa-wc-2026" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bracketId).toBe("bk_abc");
    expect(res.bracket.matchPredictions["1"]?.outcome).toBe("home_win");

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://t.invalid/v1/bracket/me?tournament_id=fifa-wc-2026",
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-user-id"]).toBe("u_1");
  });

  it("returns ok:false code:not_found on 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { error: "not_found" }));
    const res = await loadServerBracket(
      { userId: "u_1", tournamentId: "fifa-wc-2026" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://t.invalid" },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("not_found");
    expect(res.status).toBe(404);
  });
});
