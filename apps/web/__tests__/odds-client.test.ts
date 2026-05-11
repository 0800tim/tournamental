/**
 * Tier-fallback unit tests for `lib/odds/client.ts`.
 *
 * The client tries 3 layers in order:
 *   1. Upstream `NEXT_PUBLIC_ODDS_API_URL` (real odds-ingest service).
 *   2. Local `/api/odds/*` Next.js stub (only in browser env).
 *   3. Deterministic mock from FIFA rank.
 *
 * We use a stub fetch that fails or succeeds at our discretion to assert
 * the right tier handles each case.
 */

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";

import {
  fetchMatchOdds,
  fetchTeamGroupSummary,
  fetchTeamWinnerSummary,
  generateMockOdds,
} from "../lib/odds/client";
import type { MatchOdds } from "../lib/odds/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_LIVE: MatchOdds = {
  matchNo: "1",
  homeTeam: "MEX",
  awayTeam: "RSA",
  homeWin: 0.55,
  draw: 0.25,
  awayWin: 0.20,
  source: "polymarket",
  updatedAt: "2026-05-10T00:00:00Z",
  marketId: "live-market-1",
};

describe("fetchMatchOdds tier-fallback", () => {
  it("returns the live tier when upstream succeeds", async () => {
    const fakeFetch: typeof fetch = (() => Promise.resolve(jsonResponse(VALID_LIVE))) as typeof fetch;
    const r = await fetchMatchOdds({
      matchNo: "1",
      homeTeam: "MEX",
      awayTeam: "RSA",
      upstreamBaseUrl: "https://odds.example.com",
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("live");
    expect(r.data.source).toBe("polymarket");
    expect(r.data.marketId).toBe("live-market-1");
  });

  it("falls back to the stub tier when upstream returns 5xx", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = ((url: string) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(jsonResponse({ error: "bad" }, 500));
      // Second call is the stub /api/odds/match/...
      const stubData: MatchOdds = { ...VALID_LIVE, source: "mock-stub" };
      return Promise.resolve(jsonResponse(stubData));
    }) as typeof fetch;

    const r = await fetchMatchOdds({
      matchNo: "1",
      homeTeam: "MEX",
      awayTeam: "RSA",
      upstreamBaseUrl: "https://odds.example.com",
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("stub");
    expect(calls).toBe(2);
  });

  it("falls back to mock tier when upstream throws and stub also fails", async () => {
    const fakeFetch: typeof fetch = (() => Promise.reject(new Error("net down"))) as typeof fetch;
    const r = await fetchMatchOdds({
      matchNo: "1",
      homeTeam: "MEX",
      awayTeam: "RSA",
      upstreamBaseUrl: "https://odds.example.com",
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("mock");
    expect(r.data.source).toMatch(/mock/);
    expect(r.data.homeWin).toBeGreaterThan(0);
  });

  it("falls back to mock tier when upstream is not configured (null base url)", async () => {
    const fakeFetch: typeof fetch = (() => Promise.reject(new Error("stub also down"))) as typeof fetch;
    const r = await fetchMatchOdds({
      matchNo: "5",
      homeTeam: "BRA",
      awayTeam: "GER",
      upstreamBaseUrl: null,
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("mock");
  });

  it("rejects malformed upstream payloads and falls through to mock", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = ((_url: string) => {
      calls += 1;
      if (calls === 1) {
        // Live returns 200 OK but missing fields, must be rejected.
        return Promise.resolve(jsonResponse({ wat: true }));
      }
      return Promise.reject(new Error("stub down"));
    }) as typeof fetch;

    const r = await fetchMatchOdds({
      matchNo: "9",
      homeTeam: "MEX",
      awayTeam: "RSA",
      upstreamBaseUrl: "https://odds.example.com",
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("mock");
  });

  it("respects skipStub when caller asks (used inside the route handler)", async () => {
    const fakeFetch: typeof fetch = (() => Promise.reject(new Error("net"))) as typeof fetch;
    const r = await fetchMatchOdds({
      matchNo: "stub-skip",
      homeTeam: "MEX",
      awayTeam: "RSA",
      upstreamBaseUrl: "https://odds.example.com",
      fetchImpl: fakeFetch,
      skipStub: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("mock");
  });
});

describe("fetchTeamWinnerSummary tier-fallback", () => {
  it("uses live tier when upstream is reachable", async () => {
    const live = {
      teamCode: "ARG",
      tournamentWinnerProb: 0.22,
      groupWinnerProb: null,
      source: "polymarket" as const,
      updatedAt: "2026-05-10T00:00:00Z",
    };
    const fakeFetch: typeof fetch = (() => Promise.resolve(jsonResponse(live))) as typeof fetch;
    const r = await fetchTeamWinnerSummary({
      teamCode: "ARG",
      upstreamBaseUrl: "https://odds.example.com",
      fetchImpl: fakeFetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("live");
    expect(r.data.tournamentWinnerProb).toBe(0.22);
  });

  it("falls back to deterministic mock when upstream is null", async () => {
    const r = await fetchTeamWinnerSummary({
      teamCode: "ARG",
      upstreamBaseUrl: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.tier).toBe("mock");
    expect(r.data.tournamentWinnerProb).not.toBeNull();
  });
});

describe("fetchTeamGroupSummary tier-fallback", () => {
  it("mock normalises probabilities sensibly across a 4-team group", async () => {
    const groupTeamCodes = ["ARG", "MEX", "RSA", "JOR"];
    const results = await Promise.all(
      groupTeamCodes.map((code) =>
        fetchTeamGroupSummary({
          teamCode: code,
          groupId: "X",
          groupTeamCodes,
          upstreamBaseUrl: null,
        }),
      ),
    );
    const probs = results.map((r) => (r.ok ? r.data.groupWinnerProb : 0));
    const total = probs.reduce((a, b) => a + b, 0);
    // mock weights aren't perfectly normalised at the unit level, but
    // they are within a reasonable range, the GroupWinnerChips
    // component re-normalises them to exactly 1.0 in the UI.
    expect(total).toBeGreaterThan(0.5);
    expect(total).toBeLessThan(1.5);
    // Strongest team (ARG, rank 1) should have the highest weight.
    const argProb = probs[0]!;
    expect(argProb).toBeGreaterThan(probs[3]!);
  });
});

describe("generateMockOdds direct entry point", () => {
  it("produces sane numbers for known team codes", () => {
    const o = generateMockOdds("1", "ARG", "JOR");
    expect(o.homeWin).toBeGreaterThan(0.5); // ARG much stronger
  });

  it("falls back to a stub when team codes are empty", () => {
    const o = generateMockOdds("1", "", "");
    expect(o.source).toBe("mock-stub");
    expect(o.homeWin).toBeGreaterThan(0);
  });
});
