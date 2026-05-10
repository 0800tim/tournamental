/**
 * Tests for the `scrape-stats` CLI runner.
 */

import { describe, expect, it } from "vitest";

import { parseArgs, buildPairList, runScrape } from "./scrape-stats.js";

const SAMPLE_TEAMS = [
  { code: "ARG", name: "Argentina", fifa_ranking_at_2026: 1, wikidata_q: "Q170244" },
  { code: "FRA", name: "France", fifa_ranking_at_2026: 2, wikidata_q: "Q47774" },
  { code: "BRA", name: "Brazil", fifa_ranking_at_2026: 3, wikidata_q: "Q83459" },
];

describe("parseArgs", () => {
  it("parses --kind=form + --teams + --force-refresh + --dry-run", () => {
    const o = parseArgs([
      "--kind=form",
      "--teams=arg,FRA",
      "--force-refresh",
      "--dry-run",
    ]);
    expect(o.kind).toBe("form");
    expect(o.teams).toEqual(["ARG", "FRA"]);
    expect(o.forceRefresh).toBe(true);
    expect(o.dryRun).toBe(true);
  });

  it("defaults to kind=all + write", () => {
    const o = parseArgs([]);
    expect(o.kind).toBe("all");
    expect(o.teams).toBeNull();
    expect(o.forceRefresh).toBe(false);
    expect(o.dryRun).toBe(false);
  });

  it("rejects unknown --kind", () => {
    expect(() => parseArgs(["--kind=bogus"])).toThrow();
  });
});

describe("buildPairList", () => {
  it("emits N choose 2 pairs across all teams", () => {
    const pairs = buildPairList(SAMPLE_TEAMS, null);
    expect(pairs).toHaveLength(3); // 3 choose 2
    expect(pairs[0]).toEqual({
      aCode: "ARG",
      bCode: "FRA",
      aQid: "Q170244",
      bQid: "Q47774",
    });
  });

  it("filters pairs to the --teams subset", () => {
    const pairs = buildPairList(SAMPLE_TEAMS, ["ARG", "FRA"]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.aCode).toBe("ARG");
    expect(pairs[0]?.bCode).toBe("FRA");
  });
});

describe("runScrape", () => {
  it("--dry-run produces all three files in memory + skips writes", async () => {
    const writes: { path: string; body: string }[] = [];
    const out = await runScrape({
      opts: { kind: "all", teams: ["ARG", "FRA"], forceRefresh: false, dryRun: true },
      teams: SAMPLE_TEAMS,
      cache: null,
      write: (path, body) => writes.push({ path, body }),
      log: () => {},
    });
    expect(writes).toHaveLength(0);
    expect(out.form?.teams.ARG).toBeDefined();
    expect(out.h2h?.pairs["ARG-FRA"]).toBeDefined();
    expect(out.stats?.teams.ARG).toBeDefined();
  });

  it("--kind=form writes only team-form.json", async () => {
    const writes: { path: string; body: string }[] = [];
    await runScrape({
      opts: { kind: "form", teams: ["ARG"], forceRefresh: true, dryRun: false },
      teams: SAMPLE_TEAMS,
      cache: null,
      write: (path, body) => writes.push({ path, body }),
      log: () => {},
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toContain("team-form.json");
  });

  it("--kind=h2h scrapes only the requested pairs", async () => {
    const out = await runScrape({
      opts: { kind: "h2h", teams: ["ARG", "FRA"], forceRefresh: true, dryRun: true },
      teams: SAMPLE_TEAMS,
      cache: null,
      log: () => {},
    });
    expect(Object.keys(out.h2h?.pairs ?? {})).toEqual(["ARG-FRA"]);
  });

  it("output JSONs use the version 2 schema", async () => {
    const out = await runScrape({
      opts: { kind: "all", teams: ["ARG"], forceRefresh: true, dryRun: true },
      teams: SAMPLE_TEAMS,
      cache: null,
      log: () => {},
    });
    expect(out.form?.version).toBe(2);
    expect(out.h2h?.version).toBe(2);
    expect(out.stats?.version).toBe(2);
  });
});
