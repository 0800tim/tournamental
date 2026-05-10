/**
 * Aggregates the four stats sources into the three JSONs the web app
 * consumes. Pure orchestration — no HTTP / file I/O directly; the
 * sources + cache do that.
 *
 * Aggregation rules:
 *
 *   - **Form** (one source: FBref). When FBref returns nothing for a
 *     team (e.g. team without an FBref squad page) we fall back to the
 *     mock so the JSON keeps the team's slot populated. Confidence
 *     follows the source weight in `SOURCE_WEIGHTS`.
 *
 *   - **H2H** (StatsBomb local + Wikidata). StatsBomb-derived meetings
 *     are authoritative and always win on date conflicts. Wikidata
 *     meetings are merged in; duplicates (same date + same scoreline)
 *     are dropped. The output `source` field on the file is the union
 *     of the source labels actually used.
 *
 *   - **Stats** (API-Football). Single-source: API-Football when the
 *     env key is set, mock otherwise. The aggregator preserves the
 *     existing curated stub values for any team API-Football doesn't
 *     cover (so we don't regress hand-picked numbers for the demo).
 */

import type {
  FormGame,
  H2HFile,
  H2HMeeting,
  ScrapeReport,
  TeamFormFile,
  TeamStats,
  TeamStatsFile,
} from "./types.js";
import type { TeamFormSource } from "./sources/fbref-team-form.js";
import type { H2HSource } from "./sources/wikidata-h2h.js";
import type { H2HSourceLocal } from "./sources/statsbomb-h2h-types.js";
import type { StatsSource } from "./sources/apifootball-stats.js";
import { StatsCache } from "./cache.js";

// ---------- form ----------

export interface FormAggregateOptions {
  readonly teams: readonly string[];
  readonly source: TeamFormSource;
  readonly mockSource: TeamFormSource;
  readonly cache?: StatsCache | null;
  readonly forceRefresh?: boolean;
}

export interface FormAggregateResult {
  readonly file: TeamFormFile;
  readonly report: ScrapeReport["form"];
}

export async function aggregateForm(
  opts: FormAggregateOptions,
): Promise<FormAggregateResult> {
  const teamsOut: Record<string, readonly FormGame[]> = {};
  let scraped = 0;
  let fromCache = 0;
  let usedReal = 0;
  for (const code of opts.teams) {
    const upper = code.toUpperCase();
    const cached = !opts.forceRefresh ? opts.cache?.read<readonly FormGame[]>("form", upper) : null;
    if (cached && cached.length > 0) {
      teamsOut[upper] = cached;
      fromCache += 1;
      // Track real-source stats from the cached payload's source labels.
      if (cached[0]?.source && cached[0].source !== "mock") usedReal += 1;
      continue;
    }
    let games = await opts.source.fetchTeamForm(upper);
    if (games.length === 0) {
      games = await opts.mockSource.fetchTeamForm(upper);
    }
    // Count as a real-source hit only when the rows themselves declare a
    // non-mock provenance — keeps the file-level `source` label honest
    // when the primary source happens to *be* the mock.
    if (games.length > 0 && games[0]?.source && games[0].source !== "mock") {
      usedReal += 1;
    }
    teamsOut[upper] = games;
    scraped += 1;
    opts.cache?.write("form", upper, games);
  }
  const source: TeamFormFile["source"] =
    usedReal === 0 ? "mock" : usedReal === opts.teams.length ? "fbref" : "mixed";
  return {
    file: {
      version: 2,
      lastUpdated: new Date().toISOString(),
      source,
      teams: teamsOut,
    },
    report: {
      teamsScraped: scraped,
      teamsFromCache: fromCache,
      source,
    },
  };
}

// ---------- h2h ----------

export interface H2HAggregateOptions {
  readonly pairs: readonly { aCode: string; bCode: string; aQid: string; bQid: string }[];
  readonly remote: H2HSource;
  readonly local: H2HSourceLocal;
  readonly cache?: StatsCache | null;
  readonly forceRefresh?: boolean;
}

export interface H2HAggregateResult {
  readonly file: H2HFile;
  readonly report: ScrapeReport["h2h"];
}

/** Alpha-sort + join helper used as the JSON pair key. */
export function pairKey(a: string, b: string): string {
  return [a.toUpperCase(), b.toUpperCase()].sort().join("-");
}

export async function aggregateH2H(
  opts: H2HAggregateOptions,
): Promise<H2HAggregateResult> {
  const pairs: Record<string, readonly H2HMeeting[]> = {};
  let scraped = 0;
  let fromCache = 0;
  let usedReal = 0;
  let usedStatsBomb = 0;

  for (const { aCode, bCode, aQid, bQid } of opts.pairs) {
    const key = pairKey(aCode, bCode);
    const cached = !opts.forceRefresh ? opts.cache?.read<readonly H2HMeeting[]>("h2h", key) : null;
    if (cached && cached.length > 0) {
      pairs[key] = cached;
      fromCache += 1;
      if (cached.some((m) => m.source === "statsbomb")) usedStatsBomb += 1;
      if (cached.some((m) => m.source === "wikidata")) usedReal += 1;
      continue;
    }
    const local = opts.local.fetchH2H(aCode, bCode);
    const remote = await opts.remote.fetchH2H(aCode, bCode, aQid, bQid);
    const merged = mergeH2HMeetings(local, remote);
    if (merged.length === 0) continue; // skip empty pairs to keep JSON tight
    pairs[key] = merged;
    scraped += 1;
    // Count provenance from the merged payload — only "statsbomb" (local
    // corpus) and "wikidata" rows count as real; "mock" rows do not.
    if (merged.some((m) => m.source === "statsbomb")) usedStatsBomb += 1;
    if (merged.some((m) => m.source === "wikidata")) usedReal += 1;
    opts.cache?.write("h2h", key, merged);
  }
  // Source label: a high-level summary of where the data came from.
  //   - "mixed" if both wikidata + statsbomb contributed.
  //   - "wikidata" / "statsbomb" if only one real source did and it
  //     covers ≥10% of the pairs (otherwise the label is misleading).
  //   - "mock" otherwise (CI default + sparse corpus).
  let source: H2HFile["source"];
  const totalPairs = scraped + fromCache || 1;
  const realCoverage = (usedReal + usedStatsBomb) / totalPairs;
  if (usedReal > 0 && usedStatsBomb > 0) {
    source = "mixed";
  } else if (realCoverage < 0.1) {
    source = "mock";
  } else if (usedReal > 0) {
    source = "wikidata";
  } else {
    source = "statsbomb";
  }
  return {
    file: {
      version: 2,
      lastUpdated: new Date().toISOString(),
      source,
      pairs,
    },
    report: {
      pairsScraped: scraped,
      pairsFromCache: fromCache,
      source,
    },
  };
}

/**
 * Merge StatsBomb-local + Wikidata-remote meetings, preferring local
 * on date collisions. Local entries are inserted first; remote entries
 * are dropped if they share a date with any local entry (StatsBomb is
 * the authoritative source for any historical match in the corpus).
 *
 * Result is sorted most-recent first and trimmed to 5 rows (matching
 * the legacy stub).
 */
export function mergeH2HMeetings(
  local: readonly H2HMeeting[],
  remote: readonly H2HMeeting[],
): readonly H2HMeeting[] {
  const localDates = new Set(local.map((m) => m.date));
  const seenScoreline = new Set<string>();
  const out: H2HMeeting[] = [];
  for (const m of local) {
    const k = `${m.date}|${m.homeScore}-${m.awayScore}`;
    if (seenScoreline.has(k)) continue;
    seenScoreline.add(k);
    out.push(m);
  }
  for (const m of remote) {
    if (localDates.has(m.date)) continue; // local wins date collisions
    const k = `${m.date}|${m.homeScore}-${m.awayScore}`;
    if (seenScoreline.has(k)) continue;
    seenScoreline.add(k);
    out.push(m);
  }
  out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return out.slice(0, 5);
}

// ---------- stats ----------

export interface StatsAggregateOptions {
  readonly teams: readonly string[];
  /** Curated baseline values to preserve for teams the source can't enrich. */
  readonly baseline: Record<string, TeamStats>;
  readonly source: StatsSource;
  readonly mockSource: StatsSource;
  /** Optional: per-code override for the API-Football team id. */
  readonly apiTeamIds?: Readonly<Record<string, number>>;
  readonly cache?: StatsCache | null;
  readonly forceRefresh?: boolean;
  readonly season?: string;
}

export interface StatsAggregateResult {
  readonly file: TeamStatsFile;
  readonly report: ScrapeReport["stats"];
}

export async function aggregateStats(
  opts: StatsAggregateOptions,
): Promise<StatsAggregateResult> {
  const out: Record<string, TeamStats> = {};
  let scraped = 0;
  let fromCache = 0;
  let usedReal = 0;
  for (const code of opts.teams) {
    const upper = code.toUpperCase();
    // 1. Cache first.
    const cached = !opts.forceRefresh ? opts.cache?.read<TeamStats>("stats", upper) : null;
    if (cached) {
      out[upper] = cached;
      fromCache += 1;
      if (cached.source && cached.source !== "mock") usedReal += 1;
      continue;
    }
    // 2. Real source if available, then mock, then baseline curated stub.
    const apiId = opts.apiTeamIds?.[upper];
    let stats: TeamStats | null = null;
    try {
      stats = await opts.source.fetchTeamStats(upper, apiId);
    } catch {
      stats = null;
    }
    if (!stats) {
      stats = await opts.mockSource.fetchTeamStats(upper);
    }
    if (!stats) {
      // Last resort: curated baseline if present.
      stats = opts.baseline[upper] ?? null;
    }
    if (!stats) continue;
    if (stats.source && stats.source !== "mock") usedReal += 1;
    out[upper] = stats;
    scraped += 1;
    opts.cache?.write("stats", upper, stats);
  }
  // Slot in any baseline teams the loop didn't touch (when called with a
  // narrow `--teams=` filter). Preserves curated values.
  for (const [code, stats] of Object.entries(opts.baseline)) {
    if (!out[code]) out[code] = stats;
  }
  const source: TeamStatsFile["source"] =
    usedReal === 0 ? "mock" : usedReal === opts.teams.length ? "apifootball" : "mixed";
  return {
    file: {
      version: 2,
      lastUpdated: new Date().toISOString(),
      season: opts.season ?? "2025-26",
      source,
      teams: out,
    },
    report: {
      teamsScraped: scraped,
      teamsFromCache: fromCache,
      source,
    },
  };
}
