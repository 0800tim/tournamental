/**
 * Tests for the read-only data feed helpers:
 *   getOdds       , real fetch + fallback + favourite argmax
 *   getInjuries   , Phase 1 stub shape
 *   getWeather    , Phase 1 stub shape
 */
import { describe, it, expect } from "vitest";

import {
  getOdds,
  getInjuries,
  getWeather,
  toOddsSnapshot,
} from "../src/feeds.js";

type MockFetch = (url: string, init?: RequestInit) => Promise<Response>;

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("getOdds", () => {
  it("calls /v1/odds/<matchId> on the configured baseUrl", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> | undefined;
    const fetchMock: MockFetch = (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        okResponse({
          match_id: "1",
          home_win: 0.62,
          draw: 0.21,
          away_win: 0.17,
          source: "polymarket",
          snapshot_at: "2026-06-11T18:00:00Z",
        }),
      );
    };
    const result = await getOdds("1", {
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe("http://x/v1/odds/1");
    expect(capturedHeaders?.Accept).toBe("application/json");
    expect(result.match_id).toBe("1");
    expect(result.home_win).toBeCloseTo(0.62);
    expect(result.draw).toBeCloseTo(0.21);
    expect(result.away_win).toBeCloseTo(0.17);
    expect(result.favourite).toBe("home_win");
    expect(result.source).toBe("polymarket");
    expect(result.snapshot_at).toBe("2026-06-11T18:00:00Z");
  });

  it("computes the favourite via argmax when the server omits it", async () => {
    const fetchMock: MockFetch = () =>
      Promise.resolve(
        okResponse({
          match_id: "m2",
          home_win: 0.2,
          draw: 0.3,
          away_win: 0.5,
        }),
      );
    const result = await getOdds("m2", {
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.favourite).toBe("away_win");
  });

  it("accepts the docs-§6 nested probabilities shape", async () => {
    const fetchMock: MockFetch = () =>
      Promise.resolve(
        okResponse({
          match_id: "1",
          snapshot_at: "2026-06-11T18:00:00Z",
          favourite: "home_win",
          probabilities: {
            home_win: 0.62,
            draw: 0.21,
            away_win: 0.17,
          },
          source: "polymarket",
          implied_overround: 0.0,
        }),
      );
    const result = await getOdds("1", {
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.home_win).toBeCloseTo(0.62);
    expect(result.away_win).toBeCloseTo(0.17);
    expect(result.favourite).toBe("home_win");
    expect(result.source).toBe("polymarket");
  });

  it("falls back to a no_odds 50/50 result on a 404", async () => {
    const fetchMock: MockFetch = () =>
      Promise.resolve(okResponse({ error: "not_found" }, 404));
    const result = await getOdds("does-not-exist", {
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.note).toBe("no_odds");
    expect(result.favourite).toBe("home_win");
    expect(result.source).toBe("fallback");
    expect(result.home_win).toBe(0.5);
    expect(result.away_win).toBe(0.5);
  });

  it("falls back when the network throws", async () => {
    const fetchMock: MockFetch = () => Promise.reject(new Error("ECONNRESET"));
    const result = await getOdds("1", {
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.note).toBe("no_odds");
  });

  it("sends the Authorization header when apiKey is supplied", async () => {
    let captured: Record<string, string> | undefined;
    const fetchMock: MockFetch = (_url, init) => {
      captured = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        okResponse({
          match_id: "1",
          home_win: 0.5,
          draw: 0,
          away_win: 0.5,
        }),
      );
    };
    await getOdds("1", {
      baseUrl: "http://x",
      apiKey: "tnm_secretkey_value",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(captured?.Authorization).toBe("Bearer tnm_secretkey_value");
  });

  it("toOddsSnapshot maps to the public OddsSnapshot shape", () => {
    const result = {
      match_id: "1",
      home_win: 0.6,
      draw: 0.2,
      away_win: 0.2,
      favourite: "home_win" as const,
      source: "polymarket",
    };
    const snap = toOddsSnapshot(result);
    expect(snap).toEqual({
      match_id: "1",
      home_win: 0.6,
      draw: 0.2,
      away_win: 0.2,
      source: "polymarket",
    });
  });

  it("rejects an empty matchId", async () => {
    await expect(getOdds("")).rejects.toThrow(/matchId/);
  });
});

describe("getInjuries (Phase 1 stub)", () => {
  it("returns an empty injury list with a stable shape", async () => {
    const result = await getInjuries("ARG", "FRA");
    expect(result.home_team).toBe("ARG");
    expect(result.away_team).toBe("FRA");
    expect(result.home.out).toEqual([]);
    expect(result.home.doubtful).toEqual([]);
    expect(result.away.out).toEqual([]);
    expect(result.away.doubtful).toEqual([]);
    expect(result.source).toBe("stub");
  });

  it("requires home and away codes", async () => {
    await expect(getInjuries("", "FRA")).rejects.toThrow(/homeCode/);
    await expect(getInjuries("ARG", "")).rejects.toThrow(/awayCode/);
  });
});

describe("getWeather (Phase 1 stub)", () => {
  it("returns a forecast with null fields", async () => {
    const result = await getWeather("MEX-AZTEC", "2026-06-11T18:00:00Z");
    expect(result.venue_id).toBe("MEX-AZTEC");
    expect(result.kickoff_utc).toBe("2026-06-11T18:00:00Z");
    expect(result.forecast.temp_c).toBeNull();
    expect(result.forecast.humidity_pct).toBeNull();
    expect(result.forecast.wind_kph).toBeNull();
    expect(result.forecast.precipitation_mm).toBeNull();
    expect(result.source).toBe("stub");
  });

  it("requires a venue id and a kickoff string", async () => {
    await expect(getWeather("", "2026-06-11T18:00:00Z")).rejects.toThrow(
      /venueId/,
    );
    await expect(getWeather("MEX-AZTEC", "")).rejects.toThrow(/kickoffUtc/);
  });
});
