/**
 * Scrape + emit `apps/web/data/{team-form,head-to-head,team-stats}.json`.
 *
 * Reads the canonical 48-team list at `data/fifa-wc-2026/teams.json`,
 * runs the per-kind scraper, and writes the merged result. Idempotent
 * via the per-kind file cache (default 24h TTL); pass `--force-refresh`
 * to ignore the cache.
 *
 * Usage:
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-stats --kind=form
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-stats --kind=h2h
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-stats --kind=stats
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-stats --kind=all
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-stats --kind=form --teams=ARG,FRA --force-refresh
 *
 * Backends:
 *   - Default (no env): all sources mocked → safe for CI.
 *   - `WC2026_DATA_BACKEND=real`: enables real backends (FBref +
 *     Wikidata; API-Football *also* needs `APIFOOTBALL_KEY`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  StatsCache,
  aggregateForm,
  aggregateH2H,
  aggregateStats,
  pairKey,
} from "../src/stats/index.js";
import {
  MockTeamFormSource,
  createTeamFormSource,
} from "../src/stats/sources/fbref-team-form.js";
import {
  MockH2HSource,
  createH2HSource,
} from "../src/stats/sources/wikidata-h2h.js";
import { StatsBombH2HSource } from "../src/stats/sources/statsbomb-h2h.js";
import {
  MockStatsSource,
  createStatsSource,
} from "../src/stats/sources/apifootball-stats.js";
import type {
  H2HFile,
  TeamFormFile,
  TeamStats,
  TeamStatsFile,
} from "../src/stats/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEAMS_PATH = resolve(HERE, "..", "..", "..", "data", "fifa-wc-2026", "teams.json");
const OUT_FORM = resolve(HERE, "..", "..", "web", "data", "team-form.json");
const OUT_H2H = resolve(HERE, "..", "..", "web", "data", "head-to-head.json");
const OUT_STATS = resolve(HERE, "..", "..", "web", "data", "team-stats.json");

interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly fifa_ranking_at_2026: number;
  readonly wikidata_q: string | null;
}

interface CanonicalTeamsFile {
  readonly teams: readonly CanonicalTeam[];
}

export type ScrapeKind = "form" | "h2h" | "stats" | "all";

export interface CliOpts {
  readonly kind: ScrapeKind;
  readonly teams: readonly string[] | null;
  readonly forceRefresh: boolean;
  readonly dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): CliOpts {
  let kind: ScrapeKind = "all";
  let teams: string[] | null = null;
  let forceRefresh = false;
  let dryRun = false;
  for (const a of argv) {
    if (a.startsWith("--kind=")) {
      const k = a.slice("--kind=".length).toLowerCase();
      if (k !== "form" && k !== "h2h" && k !== "stats" && k !== "all") {
        throw new Error(`--kind must be one of form|h2h|stats|all (got ${k})`);
      }
      kind = k;
    } else if (a.startsWith("--teams=")) {
      teams = a
        .slice("--teams=".length)
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0);
    } else if (a === "--force-refresh") {
      forceRefresh = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    }
  }
  return { kind, teams, forceRefresh, dryRun };
}

export function readTeams(path = TEAMS_PATH): readonly CanonicalTeam[] {
  const raw = readFileSync(path, "utf8");
  const file = JSON.parse(raw) as CanonicalTeamsFile;
  return file.teams;
}

/** Read the legacy stub (so we can preserve `_note` + curated baseline values). */
export function readBaseline<T extends { teams: Record<string, unknown> }>(
  path: string,
): T | null {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Generate the `pairs` list for the H2H aggregator. By default we only
 * scrape pairs that share a confederation *or* are in our curated
 * "high-profile" list — scraping all 1128 pairs is expensive on
 * Wikidata + most of those pairs have never met.
 *
 * The curated list is derived from confederation overlap + classical
 * rivalries. If `--teams=` is set, we only generate pairs within the
 * provided team list.
 */
export function buildPairList(
  teams: readonly CanonicalTeam[],
  filter: readonly string[] | null,
): ReadonlyArray<{ aCode: string; bCode: string; aQid: string; bQid: string }> {
  const filterSet = filter && filter.length > 0 ? new Set(filter) : null;
  const eligible = teams.filter((t) => !filterSet || filterSet.has(t.code));
  const out: { aCode: string; bCode: string; aQid: string; bQid: string }[] = [];
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i]!;
      const b = eligible[j]!;
      out.push({
        aCode: a.code,
        bCode: b.code,
        aQid: a.wikidata_q ?? "",
        bQid: b.wikidata_q ?? "",
      });
    }
  }
  return out;
}

export interface RunOpts {
  readonly opts?: CliOpts;
  /** Test injection seam — full canonical teams list. */
  readonly teams?: readonly CanonicalTeam[];
  readonly cache?: StatsCache | null;
  readonly write?: (path: string, body: string) => void;
  readonly log?: (msg: string) => void;
}

export interface RunResult {
  readonly form?: TeamFormFile;
  readonly h2h?: H2HFile;
  readonly stats?: TeamStatsFile;
}

export async function runScrape(io: RunOpts = {}): Promise<RunResult> {
  const opts = io.opts ?? { kind: "all", teams: null, forceRefresh: false, dryRun: false };
  const teams = io.teams ?? readTeams();
  const log = io.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const writer = io.write ?? defaultWriter;
  const cache = io.cache === undefined ? new StatsCache() : io.cache;
  // Selected codes: --teams filter or all 48.
  const selectedCodes = opts.teams && opts.teams.length > 0
    ? opts.teams
    : teams.map((t) => t.code);

  const result: { form?: TeamFormFile; h2h?: H2HFile; stats?: TeamStatsFile } = {};

  if (opts.kind === "form" || opts.kind === "all") {
    log(`scraping form for ${selectedCodes.length} teams...`);
    const { file, report } = await aggregateForm({
      teams: selectedCodes,
      source: createTeamFormSource(),
      mockSource: new MockTeamFormSource(),
      cache,
      forceRefresh: opts.forceRefresh,
    });
    log(
      `form: scraped=${report.teamsScraped} cached=${report.teamsFromCache} source=${report.source}`,
    );
    result.form = file;
    if (!opts.dryRun) {
      writer(OUT_FORM, JSON.stringify(file, null, 2) + "\n");
      log(`wrote ${OUT_FORM}`);
    }
  }

  if (opts.kind === "h2h" || opts.kind === "all") {
    const pairs = buildPairList(teams, opts.teams);
    log(`scraping h2h for ${pairs.length} pairs...`);
    const { file, report } = await aggregateH2H({
      pairs,
      remote: createH2HSource(),
      local: new StatsBombH2HSource(),
      cache,
      forceRefresh: opts.forceRefresh,
    });
    log(
      `h2h: scraped=${report.pairsScraped} cached=${report.pairsFromCache} source=${report.source}`,
    );
    result.h2h = file;
    if (!opts.dryRun) {
      writer(OUT_H2H, JSON.stringify(file, null, 2) + "\n");
      log(`wrote ${OUT_H2H}`);
    }
  }

  if (opts.kind === "stats" || opts.kind === "all") {
    log(`scraping stats for ${selectedCodes.length} teams...`);
    // Preserve the curated baseline values from the existing JSON so we
    // don't regress hand-tuned numbers when API-Football is unavailable.
    const existing = readBaseline<{ teams: Record<string, TeamStats> }>(OUT_STATS);
    const baseline = existing?.teams ?? {};
    const { file, report } = await aggregateStats({
      teams: selectedCodes,
      baseline,
      source: createStatsSource(),
      mockSource: new MockStatsSource(),
      cache,
      forceRefresh: opts.forceRefresh,
      season: "2025-26",
    });
    log(
      `stats: scraped=${report.teamsScraped} cached=${report.teamsFromCache} source=${report.source}`,
    );
    result.stats = file;
    if (!opts.dryRun) {
      writer(OUT_STATS, JSON.stringify(file, null, 2) + "\n");
      log(`wrote ${OUT_STATS}`);
    }
  }

  return result;
}

function defaultWriter(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

// Re-export for tests.
export { pairKey };

const isDirectExec = (() => {
  try {
    const url = fileURLToPath(import.meta.url);
    return process.argv[1] && resolve(process.argv[1]) === resolve(url);
  } catch {
    return false;
  }
})();

if (isDirectExec) {
  const opts = parseArgs(process.argv.slice(2));
  runScrape({ opts }).catch((err) => {
    process.stderr.write(`scrape-stats failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
