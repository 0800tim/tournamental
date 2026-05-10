/**
 * Tests for the SportRadar + API-Football adapter stubs.
 *
 * Coverage:
 *   - Both providers throw MissingApiKeyError when WC2026_DATA_API_KEY is
 *     absent (no silent fallback to mock).
 *   - HTTP request shape: correct URL prefix, auth header, and method.
 *   - Response mapping: status/score/scorers extracted into LiveMatchState.
 *   - Provider barrel `parseBackend` and `buildProvider` select correctly.
 */

import { describe, expect, it, vi } from "vitest";

import { ApiFootballLiveDataProvider } from "../../src/live/apifootball-provider.js";
import { MissingApiKeyError, SportRadarLiveDataProvider } from "../../src/live/sportradar-provider.js";
import { buildProvider, parseBackend } from "../../src/live/provider.js";

describe("parseBackend", () => {
  it("defaults to mock", () => {
    expect(parseBackend(undefined)).toBe("mock");
    expect(parseBackend("")).toBe("mock");
  });
  it("accepts known backends case-insensitively", () => {
    expect(parseBackend("Mock")).toBe("mock");
    expect(parseBackend("SPORTRADAR")).toBe("sportradar");
    expect(parseBackend("apifootball")).toBe("apifootball");
    expect(parseBackend("api-football")).toBe("apifootball");
  });
  it("throws on unknown backends", () => {
    expect(() => parseBackend("statsperform")).toThrow(/Unknown WC2026_DATA_BACKEND/);
  });
});

describe("buildProvider", () => {
  it("returns a real adapter when sportradar is selected", () => {
    const p = buildProvider({
      env: { WC2026_DATA_BACKEND: "sportradar", WC2026_DATA_API_KEY: "test-key" },
    });
    expect(p.name).toBe("sportradar");
  });
  it("returns a real adapter when apifootball is selected", () => {
    const p = buildProvider({
      env: { WC2026_DATA_BACKEND: "apifootball", WC2026_DATA_API_KEY: "test-key" },
    });
    expect(p.name).toBe("apifootball");
  });
});

describe("SportRadarLiveDataProvider", () => {
  it("throws MissingApiKeyError when key is absent", async () => {
    const p = new SportRadarLiveDataProvider({ apiKey: undefined });
    await expect(p.fetchUpcoming(10)).rejects.toBeInstanceOf(MissingApiKeyError);
    await expect(p.fetchMatch("abc")).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("builds the expected timeline URL with api_key in query", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = vi.fn(async (url: string, headers: Record<string, string>) => {
      calls.push({ url, headers });
      return {
        status: 200,
        body: {
          sport_event_status: { status: "live", home_score: 1, away_score: 0, clock: { played: "23:00" } },
          timeline: [
            {
              id: 1,
              type: "score_change",
              time: "2026-06-11T19:23:00Z",
              match_time: 23,
              competitor: "home",
              players: [{ name: "Messi" }],
              description: "Goal",
            },
          ],
          sport_event: {
            id: "abc",
            start_time: "2026-06-11T19:00:00Z",
            competitors: [
              { id: "h", qualifier: "home", abbreviation: "ARG", name: "Argentina" },
              { id: "a", qualifier: "away", abbreviation: "FRA", name: "France" },
            ],
          },
        },
        headers: {},
      };
    });
    const p = new SportRadarLiveDataProvider({ apiKey: "secret-key", fetcher });
    const state = await p.fetchMatch("abc");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/sport_events/abc/timeline.json");
    expect(calls[0]!.url).toContain("api_key=secret-key");
    expect(state.status).toBe("live");
    expect(state.homeScore).toBe(1);
    expect(state.scorers[0]?.playerName).toBe("Messi");
    expect(state.scorers[0]?.teamId).toBe("ARG");
  });

  it("maps schedule rows on fetchUpcoming", async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      body: {
        sport_events: [
          {
            sport_event: {
              id: "evt1",
              start_time: "2026-06-12T22:00:00Z",
              competitors: [
                { qualifier: "home", abbreviation: "MEX", name: "Mexico" },
                { qualifier: "away", abbreviation: "RSA", name: "South Africa" },
              ],
              venue: { name: "Estadio Azteca", country_code: "MEX" },
            },
          },
        ],
      },
      headers: {},
    }));
    const p = new SportRadarLiveDataProvider({ apiKey: "k", fetcher });
    const fixtures = await p.fetchUpcoming(5);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]!.matchId).toBe("evt1");
    expect(fixtures[0]!.homeTeamId).toBe("MEX");
    expect(fixtures[0]!.host).toBe("MX");
  });

  it("throws on non-200 timeline status", async () => {
    const fetcher = vi.fn(async () => ({ status: 503, body: {}, headers: {} }));
    const p = new SportRadarLiveDataProvider({ apiKey: "k", fetcher });
    await expect(p.fetchMatch("abc")).rejects.toThrow(/HTTP 503/);
  });
});

describe("ApiFootballLiveDataProvider", () => {
  it("throws MissingApiKeyError when key is absent", async () => {
    const p = new ApiFootballLiveDataProvider({ apiKey: undefined });
    await expect(p.fetchUpcoming(5)).rejects.toBeInstanceOf(MissingApiKeyError);
    await expect(p.fetchMatch("123")).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("uses x-apisports-key header by default", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = vi.fn(async (url: string, headers: Record<string, string>) => {
      calls.push({ url, headers });
      return {
        status: 200,
        body: {
          response: [
            {
              fixture: {
                id: 42,
                date: "2026-06-11T19:00:00Z",
                status: { short: "1H", elapsed: 12 },
                venue: { name: "Estadio Azteca", city: "Mexico City" },
              },
              teams: { home: { code: "MEX", name: "Mexico" }, away: { code: "RSA", name: "South Africa" } },
              goals: { home: 1, away: 0 },
              events: [
                {
                  time: { elapsed: 8 },
                  team: { code: "MEX", name: "Mexico" },
                  player: { name: "Lozano" },
                  type: "Goal",
                  detail: "Normal Goal",
                },
              ],
            },
          ],
        },
      };
    });
    const p = new ApiFootballLiveDataProvider({ apiKey: "test-key", fetcher });
    const state = await p.fetchMatch("42");
    expect(calls[0]!.headers["x-apisports-key"]).toBe("test-key");
    expect(calls[0]!.url).toContain("/fixtures?id=42");
    expect(state.status).toBe("live");
    expect(state.homeScore).toBe(1);
    expect(state.scorers[0]?.playerName).toBe("Lozano");
    expect(state.scorers[0]?.type).toBe("goal");
  });

  it("uses RapidAPI headers when viaRapidApi is true", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = vi.fn(async (url: string, headers: Record<string, string>) => {
      calls.push({ url, headers });
      return {
        status: 200,
        body: {
          response: [
            {
              fixture: { id: 1, date: "2026-06-11T19:00:00Z", status: { short: "NS", elapsed: 0 } },
              teams: { home: { name: "X" }, away: { name: "Y" } },
              goals: { home: 0, away: 0 },
              events: [],
            },
          ],
        },
      };
    });
    const p = new ApiFootballLiveDataProvider({ apiKey: "k", fetcher, viaRapidApi: true });
    await p.fetchMatch("1");
    expect(calls[0]!.headers["x-rapidapi-key"]).toBe("k");
    expect(calls[0]!.headers["x-rapidapi-host"]).toBe("api-football-v1.p.rapidapi.com");
  });

  it("classifies penalty + own-goal scoring correctly", async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      body: {
        response: [
          {
            fixture: { id: 1, status: { short: "FT", elapsed: 90 } },
            teams: { home: { code: "ARG" }, away: { code: "FRA" } },
            goals: { home: 3, away: 3 },
            events: [
              { time: { elapsed: 80 }, team: { code: "FRA" }, player: { name: "Mbappé" }, type: "Goal", detail: "Penalty" },
              { time: { elapsed: 50 }, team: { code: "ARG" }, player: { name: "Otamendi" }, type: "Goal", detail: "Own Goal" },
              { time: { elapsed: 23 }, team: { code: "ARG" }, player: { name: "Messi" }, type: "Goal", detail: "Normal Goal" },
            ],
          },
        ],
      },
    }));
    const p = new ApiFootballLiveDataProvider({ apiKey: "k", fetcher });
    const state = await p.fetchMatch("1");
    const types = state.scorers.map((s) => s.type);
    expect(types).toContain("pen");
    expect(types).toContain("og");
    expect(types).toContain("goal");
    expect(state.status).toBe("final");
  });

  it("throws on missing fixture in response", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: { response: [] } }));
    const p = new ApiFootballLiveDataProvider({ apiKey: "k", fetcher });
    await expect(p.fetchMatch("999")).rejects.toThrow(/no fixture/);
  });
});
