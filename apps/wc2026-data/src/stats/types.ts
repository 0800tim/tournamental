/**
 * Shared types for the team-form / head-to-head / season-stats scraper.
 *
 * These shapes are persisted to `apps/web/data/{team-form,head-to-head,team-stats}.json`.
 * The web app already consumes the legacy stub schema (in
 * `apps/web/lib/team-form.ts`, `apps/web/lib/head-to-head.ts`,
 * `apps/web/app/match/[id]/preview/_lib/match-data.ts`); this scraper
 * extends those shapes with optional provenance fields rather than
 * breaking the existing readers. New top-level keys (`version`,
 * `lastUpdated`, `source`) are tolerated by the readers because they
 * read into typed sub-trees (`teams` / `pairs`).
 */

// ---------- team form ----------

export type FormResult = "W" | "D" | "L";

/** A single recent-match row. Matches the legacy stub shape exactly. */
export interface FormGame {
  readonly date: string; // ISO YYYY-MM-DD
  readonly opponent: string; // 3-letter FIFA code
  readonly home: boolean;
  readonly goals_for: number;
  readonly goals_against: number;
  readonly result: FormResult;
  readonly competition: string;
  /** Optional provenance string, e.g. `fbref:url`. Ignored by the web app. */
  readonly source?: string;
}

export interface TeamFormFile {
  readonly version: number;
  readonly lastUpdated: string;
  readonly source: "fbref" | "wikidata" | "statsbomb" | "mock" | "mixed";
  /** Per-team last-N games, most-recent first. */
  readonly teams: Record<string, readonly FormGame[]>;
  /** Echoed from the legacy stub so existing _todo callers don't break. */
  readonly _note?: string;
}

// ---------- head-to-head ----------

export interface H2HMeeting {
  readonly date: string;
  readonly homeCode: string;
  readonly awayCode: string;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly competition: string;
  readonly venue?: string;
  readonly extraTime?: boolean;
  readonly penalties?: string;
  readonly source?: string;
}

export interface H2HFile {
  readonly version: number;
  readonly lastUpdated: string;
  readonly source: "wikidata" | "statsbomb" | "mock" | "mixed";
  /** Direction-insensitive: keyed by alpha-sorted `${A}-${B}`. */
  readonly pairs: Record<string, readonly H2HMeeting[]>;
}

// ---------- season-aggregate stats ----------

export interface TeamStats {
  readonly xg_per_match: number;
  readonly xga_per_match: number;
  readonly possession_pct: number;
  readonly shots_per_match: number;
  readonly shots_on_target_per_match: number;
  readonly pass_accuracy_pct: number;
  readonly form_rating: number;
  /** Number of matches the aggregate is sampled over. */
  readonly matches_sampled?: number;
  readonly source?: string;
}

export interface TeamStatsFile {
  readonly version: number;
  readonly lastUpdated: string;
  readonly season: string;
  readonly source: "apifootball" | "fbref" | "mock" | "mixed";
  readonly teams: Record<string, TeamStats>;
}

// ---------- aggregator + cache ----------

/** A single source's confidence in [0..1]. Higher = more authoritative. */
export const SOURCE_WEIGHTS: Readonly<Record<string, number>> = {
  // Authoritative aggregators with verified pipelines.
  statsbomb: 1.0,
  fbref: 0.9,
  apifootball: 0.85,
  // Public structured data; canonical for historical results.
  wikidata: 0.8,
  // Synthetic; used only when nothing else is available.
  mock: 0.1,
};

export interface ScrapeReport {
  readonly form: {
    readonly teamsScraped: number;
    readonly teamsFromCache: number;
    readonly source: TeamFormFile["source"];
  };
  readonly h2h: {
    readonly pairsScraped: number;
    readonly pairsFromCache: number;
    readonly source: H2HFile["source"];
  };
  readonly stats: {
    readonly teamsScraped: number;
    readonly teamsFromCache: number;
    readonly source: TeamStatsFile["source"];
  };
}

/**
 * Cache file shape. Each cache key (a team code, a pair, or a stats
 * lookup) gets a tiny envelope tracking when it was last fetched + the
 * payload itself.
 */
export interface CacheEntry<T> {
  readonly fetchedAt: string;
  readonly payload: T;
}
