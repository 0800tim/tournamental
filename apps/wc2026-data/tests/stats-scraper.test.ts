/**
 * Tests for the stats scraper (form, head-to-head, season aggregates).
 *
 * No real network: every fetch is stubbed. The mock backends are
 * verified for determinism; the real backends for URL composition,
 * caching, throttling, and error handling.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  StatsCache,
  normaliseKey,
} from "../src/stats/cache.js";
import {
  MockTeamFormSource,
  FbrefTeamFormSource,
  parseFbrefMatchLog,
  canonicaliseOpponent,
  fbrefUrlFor,
  createTeamFormSource,
  FBREF_SQUAD_IDS,
} from "../src/stats/sources/fbref-team-form.js";
import {
  MockH2HSource,
  WikidataH2HSource,
  buildH2HSparqlQuery,
  parseH2HResponse,
  createH2HSource,
} from "../src/stats/sources/wikidata-h2h.js";
import { StatsBombH2HSource } from "../src/stats/sources/statsbomb-h2h.js";
import {
  MockStatsSource,
  ApiFootballStatsSource,
  parseApiFootballStats,
  createStatsSource,
} from "../src/stats/sources/apifootball-stats.js";
import {
  aggregateForm,
  aggregateH2H,
  aggregateStats,
  mergeH2HMeetings,
  pairKey,
} from "../src/stats/aggregator.js";

// ---------- StatsCache ----------

describe("StatsCache", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vtorn-stats-cache-"));
  });

  it("round-trips a payload", () => {
    const c = new StatsCache({ root });
    c.write("form", "ARG", [{ result: "W" }]);
    const out = c.read<{ result: string }[]>("form", "ARG");
    expect(out?.[0]?.result).toBe("W");
  });

  it("returns null for a missing entry", () => {
    const c = new StatsCache({ root });
    expect(c.read("form", "missing")).toBeNull();
  });

  it("expires past the TTL", () => {
    let now = 1_700_000_000_000;
    const c = new StatsCache({ root, ttlMs: 1000, nowMs: () => now });
    c.write("form", "ARG", [{ result: "W" }]);
    now += 5_000;
    expect(c.read("form", "ARG")).toBeNull();
  });

  it("invalidate() drops an entry", () => {
    const c = new StatsCache({ root });
    c.write("h2h", "ARG-FRA", [{ date: "2022-12-18" }]);
    c.invalidate("h2h", "ARG-FRA");
    expect(c.read("h2h", "ARG-FRA")).toBeNull();
  });

  it("normaliseKey lowercases + strips weird chars", () => {
    expect(normaliseKey("ARG-FRA")).toBe("arg-fra");
    expect(normaliseKey("../../etc/passwd")).toBe("------etc-passwd");
  });
});

// ---------- FBref source ----------

describe("FBref team-form source", () => {
  it("MockTeamFormSource returns 5 deterministic games", async () => {
    const s = new MockTeamFormSource();
    const a = await s.fetchTeamForm("ARG");
    const b = await s.fetchTeamForm("ARG");
    expect(a).toHaveLength(5);
    expect(a).toEqual(b);
    expect(a[0]?.result).toBe("W");
  });

  it("fbrefUrlFor returns null for unknown teams", () => {
    expect(fbrefUrlFor("ARG")).toContain("fbref.com");
    expect(fbrefUrlFor("ZZZ")).toBeNull();
    // CUW is in the table but with an empty id (no FBref page).
    expect(fbrefUrlFor("CUW")).toBeNull();
  });

  it("FBREF_SQUAD_IDS covers all 48 WC2026 teams", () => {
    expect(Object.keys(FBREF_SQUAD_IDS)).toHaveLength(48);
  });

  it("canonicaliseOpponent picks the trailing 3-letter token", () => {
    expect(canonicaliseOpponent("fr CRO")).toBe("CRO");
    expect(canonicaliseOpponent("br BRA")).toBe("BRA");
    expect(canonicaliseOpponent("Croatia")).toBe("CRO");
  });

  it("parseFbrefMatchLog parses a sample table", () => {
    const html = `
      <table id="matchlogs_for">
        <tbody>
          <tr data-row="0">
            <th data-stat="date">2026-04-15</th>
            <td data-stat="comp">Friendlies</td>
            <td data-stat="venue">Home</td>
            <td data-stat="result">W</td>
            <td data-stat="goals_for">2</td>
            <td data-stat="goals_against">1</td>
            <td data-stat="opponent"><a href="x">br BRA</a></td>
          </tr>
          <tr data-row="1">
            <th data-stat="date">2026-03-28</th>
            <td data-stat="comp">Qualifier</td>
            <td data-stat="venue">Away</td>
            <td data-stat="result">D</td>
            <td data-stat="goals_for">1</td>
            <td data-stat="goals_against">1</td>
            <td data-stat="opponent"><a href="x">fr FRA</a></td>
          </tr>
        </tbody>
      </table>
    `;
    const games = parseFbrefMatchLog(html);
    expect(games).toHaveLength(2);
    expect(games[0]?.date).toBe("2026-04-15");
    expect(games[0]?.opponent).toBe("BRA");
    expect(games[0]?.home).toBe(true);
    expect(games[0]?.result).toBe("W");
    expect(games[1]?.home).toBe(false);
    expect(games[0]?.source).toBe("fbref");
  });

  it("parseFbrefMatchLog returns [] when the table is missing", () => {
    expect(parseFbrefMatchLog("<html></html>")).toEqual([]);
  });

  it("FbrefTeamFormSource hits FBref + parses the response", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(
        `<table id="matchlogs_for"><tbody>
          <tr data-row="0">
            <th data-stat="date">2026-04-15</th>
            <td data-stat="comp">Friendlies</td>
            <td data-stat="venue">Home</td>
            <td data-stat="result">W</td>
            <td data-stat="goals_for">3</td>
            <td data-stat="goals_against">0</td>
            <td data-stat="opponent">br BRA</td>
          </tr>
        </tbody></table>`,
        { status: 200 },
      ),
    );
    const s = new FbrefTeamFormSource({
      fetchImpl: fakeFetch as unknown as typeof fetch,
      throttleMs: 0,
    });
    const games = await s.fetchTeamForm("ARG");
    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(games).toHaveLength(1);
    expect(games[0]?.opponent).toBe("BRA");
    expect(games[0]?.result).toBe("W");
  });

  it("FbrefTeamFormSource throws on a non-2xx, non-429 response", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("err", { status: 500, statusText: "boom" }),
    );
    const s = new FbrefTeamFormSource({
      fetchImpl: fakeFetch as unknown as typeof fetch,
      throttleMs: 0,
    });
    await expect(s.fetchTeamForm("ARG")).rejects.toThrow(/500/);
  });

  it("FbrefTeamFormSource returns [] on 429 (caller falls back)", async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response("rate-limited", {
          status: 429,
          headers: { "retry-after": "0" },
        }),
    );
    const s = new FbrefTeamFormSource({
      fetchImpl: fakeFetch as unknown as typeof fetch,
      throttleMs: 0,
    });
    const games = await s.fetchTeamForm("ARG");
    expect(games).toEqual([]);
  });

  it("createTeamFormSource defaults to mock", () => {
    delete process.env.WC2026_DATA_BACKEND;
    const s = createTeamFormSource();
    expect(s).toBeInstanceOf(MockTeamFormSource);
  });

  it("createTeamFormSource opts into FBref via env", () => {
    process.env.WC2026_DATA_BACKEND = "real";
    try {
      const s = createTeamFormSource({
        fetchImpl: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
      });
      expect(s).toBeInstanceOf(FbrefTeamFormSource);
    } finally {
      delete process.env.WC2026_DATA_BACKEND;
    }
  });
});

// ---------- Wikidata H2H source ----------

describe("Wikidata H2H source", () => {
  it("buildH2HSparqlQuery embeds both Q-ids", () => {
    const q = buildH2HSparqlQuery("Q170244", "Q47774");
    expect(q).toContain("wd:Q170244");
    expect(q).toContain("wd:Q47774");
    expect(q).toContain("wikibase:label");
  });

  it("buildH2HSparqlQuery rejects malformed Q-ids", () => {
    expect(() => buildH2HSparqlQuery("Q170244; DROP", "Q47774")).toThrow();
    expect(() => buildH2HSparqlQuery("not-a-qid", "Q47774")).toThrow();
  });

  it("parseH2HResponse dedupes by ?match URI", () => {
    const raw = {
      results: {
        bindings: [
          {
            match: { value: "http://www.wikidata.org/entity/Q1234" },
            date: { value: "2022-12-18T00:00:00Z" },
            aScore: { value: "3" },
            bScore: { value: "3" },
          },
          // Duplicate cross-product row from Wikidata.
          {
            match: { value: "http://www.wikidata.org/entity/Q1234" },
            date: { value: "2022-12-18T00:00:00Z" },
            aScore: { value: "3" },
            bScore: { value: "3" },
          },
          {
            match: { value: "http://www.wikidata.org/entity/Q5678" },
            date: { value: "2018-06-30T00:00:00Z" },
            aScore: { value: "3" },
            bScore: { value: "4" },
          },
        ],
      },
    };
    const out = parseH2HResponse(raw, "ARG", "FRA");
    expect(out).toHaveLength(2);
    expect(out[0]?.date).toBe("2022-12-18");
    expect(out[0]?.homeCode).toBe("ARG");
    expect(out[0]?.awayCode).toBe("FRA");
    expect(out[0]?.source).toBe("wikidata");
  });

  it("MockH2HSource returns 3 deterministic meetings", async () => {
    const s = new MockH2HSource();
    const a = await s.fetchH2H("ARG", "FRA", "Q170244", "Q47774");
    expect(a).toHaveLength(3);
    expect(a.every((m) => m.source === "mock")).toBe(true);
  });

  it("WikidataH2HSource sends a SPARQL request with the Q-ids embedded", async () => {
    const calls: string[] = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(url.toString());
      return new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 });
    });
    const s = new WikidataH2HSource({
      fetchImpl: fakeFetch as unknown as typeof fetch,
      throttleMs: 0,
    });
    await s.fetchH2H("ARG", "FRA", "Q170244", "Q47774");
    expect(calls[0]).toContain("query.wikidata.org/sparql");
    expect(decodeURIComponent(calls[0]!)).toContain("wd:Q170244");
  });

  it("createH2HSource defaults to mock", () => {
    delete process.env.WC2026_DATA_BACKEND;
    expect(createH2HSource()).toBeInstanceOf(MockH2HSource);
  });
});

// ---------- StatsBomb local source ----------

describe("StatsBomb local H2H source", () => {
  it("returns the AR-FR final from a fixture corpus", () => {
    const s = new StatsBombH2HSource({
      corpus: {
        matches: [
          {
            date: "2022-12-18",
            team_a: "ARG",
            team_b: "FRA",
            score_a: 3,
            score_b: 3,
            venue: "Lusail",
            competition: "FIFA World Cup Final",
            extra_time: true,
            penalties: "ARG 4-2",
          },
        ],
      },
    });
    const out = s.fetchH2H("ARG", "FRA");
    expect(out).toHaveLength(1);
    expect(out[0]?.penalties).toBe("ARG 4-2");
    expect(out[0]?.source).toBe("statsbomb");
  });

  it("returns the same record when codes are flipped (direction-insensitive)", () => {
    const s = new StatsBombH2HSource({
      corpus: {
        matches: [
          { date: "2022-12-18", team_a: "ARG", team_b: "FRA", score_a: 3, score_b: 3 },
        ],
      },
    });
    expect(s.fetchH2H("FRA", "ARG")).toHaveLength(1);
  });

  it("returns [] when no corpus is on disk", () => {
    const s = new StatsBombH2HSource({ corpusPath: "/nonexistent/path.json" });
    expect(s.fetchH2H("ARG", "FRA")).toEqual([]);
  });
});

// ---------- API-Football stats source ----------

describe("API-Football stats source", () => {
  it("parseApiFootballStats turns goal averages into projected metrics", () => {
    const raw = {
      response: {
        fixtures: { played: { total: 18 } },
        goals: {
          for: { average: { total: "1.83" } },
          against: { average: { total: "0.78" } },
        },
      },
    };
    const out = parseApiFootballStats(raw, "ARG");
    expect(out).not.toBeNull();
    expect(out?.xg_per_match).toBeCloseTo(1.83, 1);
    expect(out?.matches_sampled).toBe(18);
    expect(out?.source).toBe("apifootball");
  });

  it("parseApiFootballStats returns null when no matches were played", () => {
    expect(
      parseApiFootballStats({ response: { fixtures: { played: { total: 0 } } } }, "ARG"),
    ).toBeNull();
  });

  it("MockStatsSource is deterministic per code", async () => {
    const s = new MockStatsSource();
    const a = await s.fetchTeamStats("ARG");
    const b = await s.fetchTeamStats("ARG");
    expect(a).toEqual(b);
    const c = await s.fetchTeamStats("FRA");
    expect(a).not.toEqual(c);
  });

  it("ApiFootballStatsSource throws without an API key", () => {
    delete process.env.APIFOOTBALL_KEY;
    expect(
      () =>
        new ApiFootballStatsSource({
          fetchImpl: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
        }),
    ).toThrow(/APIFOOTBALL_KEY/);
  });

  it("ApiFootballStatsSource returns null when no apiTeamId is supplied", async () => {
    const s = new ApiFootballStatsSource({
      apiKey: "test-key",
      fetchImpl: (async () =>
        new Response("{}", { status: 200 })) as unknown as typeof fetch,
      throttleMs: 0,
    });
    expect(await s.fetchTeamStats("ARG")).toBeNull();
  });

  it("createStatsSource silently falls back to mock when no key is set", () => {
    delete process.env.WC2026_DATA_BACKEND;
    delete process.env.APIFOOTBALL_KEY;
    expect(createStatsSource()).toBeInstanceOf(MockStatsSource);
  });
});

// ---------- aggregator ----------

describe("aggregator", () => {
  it("pairKey is alpha-sorted", () => {
    expect(pairKey("FRA", "ARG")).toBe("ARG-FRA");
    expect(pairKey("ARG", "FRA")).toBe("ARG-FRA");
  });

  it("mergeH2HMeetings prefers local on a date conflict + caps at 5", () => {
    const local = [
      { date: "2022-12-18", homeCode: "ARG", awayCode: "FRA", homeScore: 3, awayScore: 3, competition: "WC Final", source: "statsbomb" },
    ];
    const remote = [
      // Same date + score → dropped.
      { date: "2022-12-18", homeCode: "ARG", awayCode: "FRA", homeScore: 3, awayScore: 3, competition: "WC Final", source: "wikidata" },
      // New row — kept.
      { date: "2018-06-30", homeCode: "FRA", awayCode: "ARG", homeScore: 4, awayScore: 3, competition: "WC R16", source: "wikidata" },
    ];
    const out = mergeH2HMeetings(local, remote);
    expect(out).toHaveLength(2);
    expect(out[0]?.date).toBe("2022-12-18");
    expect(out[0]?.source).toBe("statsbomb");
    expect(out[1]?.source).toBe("wikidata");
  });

  it("aggregateForm reuses a cached entry on the second call", async () => {
    const root = mkdtempSync(join(tmpdir(), "vtorn-stats-cache-"));
    const cache = new StatsCache({ root, ttlMs: 60_000 });
    const real = new MockTeamFormSource();
    const fetchSpy = vi.spyOn(real, "fetchTeamForm");
    const args = {
      teams: ["ARG"],
      source: real,
      mockSource: new MockTeamFormSource(),
      cache,
    };
    const r1 = await aggregateForm(args);
    expect(r1.report.teamsScraped).toBe(1);
    const r2 = await aggregateForm(args);
    expect(r2.report.teamsFromCache).toBe(1);
    // Real source called exactly once across two aggregator runs.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("aggregateH2H emits no entry for a pair with zero meetings", async () => {
    const empty = {
      fetchH2H: async () => [],
    };
    const local = { fetchH2H: () => [] };
    const out = await aggregateH2H({
      pairs: [{ aCode: "ARG", bCode: "FRA", aQid: "Q170244", bQid: "Q47774" }],
      remote: empty as unknown as Parameters<typeof aggregateH2H>[0]["remote"],
      local: local as unknown as Parameters<typeof aggregateH2H>[0]["local"],
      cache: null,
    });
    expect(Object.keys(out.file.pairs)).toHaveLength(0);
    expect(out.report.pairsScraped).toBe(0);
  });

  it("aggregateStats keeps curated baseline values when source returns null", async () => {
    const noopSource = {
      async fetchTeamStats() {
        return null;
      },
    };
    const out = await aggregateStats({
      teams: ["ARG"],
      baseline: {
        ARG: {
          xg_per_match: 1.95,
          xga_per_match: 0.78,
          possession_pct: 56,
          shots_per_match: 14.2,
          shots_on_target_per_match: 5.6,
          pass_accuracy_pct: 87,
          form_rating: 7.8,
        },
      },
      source: noopSource,
      // Force the mock to also yield null so we exercise the baseline path.
      mockSource: noopSource,
      cache: null,
    });
    expect(out.file.teams.ARG?.xg_per_match).toBe(1.95);
  });

  it("aggregateStats marks source=apifootball when every team came from the real source", async () => {
    const real = {
      async fetchTeamStats(code: string) {
        return {
          xg_per_match: 1.5,
          xga_per_match: 0.9,
          possession_pct: 53,
          shots_per_match: 13,
          shots_on_target_per_match: 5,
          pass_accuracy_pct: 85,
          form_rating: 7,
          source: "apifootball" as const,
        };
      },
    };
    const out = await aggregateStats({
      teams: ["ARG", "FRA"],
      baseline: {},
      source: real,
      mockSource: new MockStatsSource(),
      cache: null,
    });
    expect(out.report.source).toBe("apifootball");
    expect(out.file.teams.ARG?.source).toBe("apifootball");
  });
});
