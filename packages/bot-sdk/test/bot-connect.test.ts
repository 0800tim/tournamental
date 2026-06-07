/**
 * Tests for Bot.connect() + Bot.matches().
 *
 * connect() should:
 *   - call /v1/me/api-keys/whoami with the Bearer key
 *   - call /v1/tournaments/<id>/matches and cache the response
 *   - return { matches, authenticated } so log lines have something to report
 *   - throw on 401 (so a misconfigured key fails fast)
 *   - degrade gracefully on 404 / network errors (so SDK still works in
 *     offline / mocked environments)
 *
 * matches() should:
 *   - return zero items if connect() was never called
 *   - filter out matches whose kickoff_utc has already passed
 *   - include matches with no kickoff (knockout TBD slots)
 *   - include matches whose kickoff is in the future
 */
import { describe, it, expect } from "vitest";

import { Bot } from "../src/bot.js";
import type { MatchSpec } from "../src/types.js";

type MockFetch = (url: string, init?: RequestInit) => Promise<Response>;

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const SAMPLE_CATALOGUE: MatchSpec[] = [
  { id: "1", stage: "group", home_code: "MEX", away_code: "PER", kickoff_utc: "2026-06-11T18:00:00Z" },
  { id: "2", stage: "group", home_code: "ARG", away_code: "FRA", kickoff_utc: "2026-06-12T15:00:00Z" },
  // Already-played match, should be filtered.
  { id: "0", stage: "group", home_code: "OLD", away_code: "PAST", kickoff_utc: "2026-05-01T00:00:00Z" },
  // Unknown kickoff (knockout cascade not resolved yet) , should be included.
  { id: "r32_01", stage: "r32", kickoff_utc: "" as unknown as string },
];

function makeWhoamiCatalogueMock(
  whoamiStatus: number,
  catalogue: MatchSpec[] | null,
): { fetchMock: MockFetch; calls: string[] } {
  const calls: string[] = [];
  const fetchMock: MockFetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/v1/me/api-keys/whoami")) {
      return Promise.resolve(okResponse({ ok: true }, whoamiStatus));
    }
    if (u.includes("/v1/tournaments/") && u.endsWith("/matches")) {
      if (catalogue === null) {
        return Promise.resolve(okResponse({ error: "not_found" }, 404));
      }
      return Promise.resolve(okResponse({ matches: catalogue }));
    }
    return Promise.resolve(okResponse({ error: "unexpected" }, 500));
  };
  return { fetchMock, calls };
}

describe("Bot.connect()", () => {
  it("calls whoami + catalogue and caches the result", async () => {
    const { fetchMock, calls } = makeWhoamiCatalogueMock(200, SAMPLE_CATALOGUE);
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const res = await bot.connect();
    expect(res.botId).toBe("b1");
    expect(res.tournamentId).toBe("fifa-wc-2026");
    expect(res.matches).toBe(SAMPLE_CATALOGUE.length);
    expect(res.authenticated).toBe(true);
    expect(bot.connected).toBe(true);
    // Both endpoints reached:
    expect(calls.some((u) => u.endsWith("/v1/me/api-keys/whoami"))).toBe(true);
    expect(
      calls.some(
        (u) => u.endsWith("/v1/tournaments/fifa-wc-2026/matches"),
      ),
    ).toBe(true);
  });

  it("throws on 401 so a bad key fails fast", async () => {
    const { fetchMock } = makeWhoamiCatalogueMock(401, SAMPLE_CATALOGUE);
    const bot = new Bot({
      apiKey: "tnm_badkey_value",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(bot.connect()).rejects.toThrow(/authentication/);
  });

  it("degrades to cache-only when whoami 404s", async () => {
    const { fetchMock } = makeWhoamiCatalogueMock(404, SAMPLE_CATALOGUE);
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const res = await bot.connect();
    expect(res.authenticated).toBe(false);
    expect(res.matches).toBe(SAMPLE_CATALOGUE.length);
  });

  it("returns empty catalogue when the catalogue endpoint is missing", async () => {
    const { fetchMock } = makeWhoamiCatalogueMock(200, null);
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const res = await bot.connect();
    expect(res.authenticated).toBe(true);
    expect(res.matches).toBe(0);
  });

  it("is idempotent (second connect refreshes catalogue)", async () => {
    let callCount = 0;
    const fetchMock: MockFetch = (url) => {
      callCount += 1;
      const u = String(url);
      if (u.endsWith("/whoami")) return Promise.resolve(okResponse({ ok: true }));
      return Promise.resolve(okResponse({ matches: SAMPLE_CATALOGUE }));
    };
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await bot.connect();
    await bot.connect();
    // Two whoami + two catalogue calls = 4 total
    expect(callCount).toBe(4);
  });
});

describe("Bot.matches()", () => {
  it("returns zero items before connect() is called", () => {
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: (() =>
        Promise.resolve(okResponse({}))) as unknown as typeof fetch,
    });
    const out = Array.from(bot.matches());
    expect(out).toEqual([]);
  });

  it("filters out matches past kickoff using the supplied now()", async () => {
    const { fetchMock } = makeWhoamiCatalogueMock(200, SAMPLE_CATALOGUE);
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await bot.connect();
    const fixedNow = Date.parse("2026-06-11T19:00:00Z");
    const out = Array.from(bot.matches(fixedNow));
    const ids = out.map((m) => m.id).sort();
    // "0" is in the past (May 2026)        , filtered
    // "1" kickoff 18:00, now 19:00         , filtered
    // "2" kickoff 12 June 15:00, in future , kept
    // "r32_01" unknown kickoff             , kept
    expect(ids).toEqual(["2", "r32_01"]);
  });

  it("setCatalogue() seeds without a network call", () => {
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "b1",
      baseUrl: "http://x",
      fetchImpl: (() =>
        Promise.reject(new Error("should not be called"))) as unknown as typeof fetch,
    });
    bot.setCatalogue([
      { id: "10", stage: "group", kickoff_utc: "2099-01-01T00:00:00Z" },
    ]);
    const out = Array.from(bot.matches(Date.parse("2026-06-11T00:00:00Z")));
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("10");
  });
});
