/**
 * Tests for the `scrape-players` CLI runner.
 */

import { describe, expect, it, vi } from "vitest";

import { parseArgs, groupByCode, runScrape } from "./scrape-players.js";
import type { SeedPlayer } from "../src/players/types.js";

const seed: SeedPlayer[] = [
  { playerId: "ARG_MESSI", name: "Lionel Messi", code: "ARG", wikidataQid: "Q615", shirtNumber: 10 },
  { playerId: "ARG_DI_MARIA", name: "Ángel Di María", code: "ARG", wikidataQid: "Q251683", shirtNumber: 11 },
  { playerId: "FRA_MBAPPE", name: "Kylian Mbappé", code: "FRA", wikidataQid: "Q19359939", shirtNumber: 10 },
];

describe("parseArgs", () => {
  it("parses --teams + --dry-run", () => {
    const o = parseArgs(["--teams=ARG,fra", "--dry-run"]);
    expect(o.dryRun).toBe(true);
    expect(o.teams).toEqual(["ARG", "FRA"]);
  });
  it("defaults to all teams + write", () => {
    expect(parseArgs([])).toEqual({ teams: null, dryRun: false });
  });
});

describe("groupByCode", () => {
  it("buckets players by code", () => {
    const g = groupByCode(seed);
    expect(g.get("ARG")).toHaveLength(2);
    expect(g.get("FRA")).toHaveLength(1);
  });
});

describe("runScrape", () => {
  it("emits a full dataset even when --teams filters; non-selected teams fall back to mock", async () => {
    const writes: { path: string; body: string }[] = [];
    const out = await runScrape(
      { teams: ["FRA"], dryRun: false },
      {
        seed,
        write: (path, body) => writes.push({ path, body }),
        log: () => {},
      },
    );
    // All 3 seed players present (FRA via primary, ARG via mock fallback).
    expect(out.players).toHaveLength(3);
    expect(out.players.map((p) => p.code).sort()).toEqual(["ARG", "ARG", "FRA"]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toContain("players-2026.json");
  });

  it("dry-run skips the write", async () => {
    const writes: { path: string; body: string }[] = [];
    await runScrape(
      { teams: null, dryRun: true },
      {
        seed,
        write: (p, b) => writes.push({ path: p, body: b }),
        log: () => {},
      },
    );
    expect(writes).toHaveLength(0);
  });

  it("output is sorted by id for deterministic diffs", async () => {
    const out = await runScrape(
      { teams: null, dryRun: true },
      { seed, log: () => {} },
    );
    const ids = out.players.map((p) => p.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });
});
