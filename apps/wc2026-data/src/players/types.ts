/**
 * Shared player-record types for the WC2026 scraper + the web app.
 *
 * Kept deliberately small. The canonical source-of-truth seed at
 * `data/fifa-wc-2026/players.json` ships only the FIFA roster shape; this
 * file describes the *enriched* shape with Wikidata-derived metadata
 * (image, club, dob, position, …) that gets baked into
 * `apps/web/data/players-2026.json` at build time.
 */

/** GK | DEF | MID | FWD per FIFA's four-position taxonomy. */
export type PlayerPosition = "GK" | "DEF" | "MID" | "FWD";

/** A single enriched player record. */
export interface EnrichedPlayer {
  /** Stable id, format `<CODE>-<SHORT>` e.g. `ARG-MESSI`. */
  readonly id: string;
  readonly wikidataQid: string;
  readonly name: string;
  readonly fullName?: string | null;
  /** 3-letter FIFA team code. */
  readonly code: string;
  /** Squad shirt number, when known. */
  readonly shirtNumber?: number | null;
  readonly position: PlayerPosition;
  /** ISO YYYY-MM-DD. Optional: not every Wikidata record has one. */
  readonly dob?: string | null;
  readonly club?: string | null;
  readonly clubLogo?: string | null;
  /** Wikimedia Commons URL for the headshot, or null. */
  readonly imageUrl?: string | null;
  /** Plain-text attribution, e.g. `Photographer · CC BY-SA 4.0`. */
  readonly imageCredit?: string | null;
  /** Original licence code, e.g. `CC BY-SA 4.0`. */
  readonly imageLicence?: string | null;
  readonly captain?: boolean;
  readonly wikipediaUrl?: string | null;
}

/** Top-level shape persisted at `apps/web/data/players-2026.json`. */
export interface PlayerDataset {
  readonly version: number;
  readonly lastUpdated: string;
  readonly source: "wikidata" | "seed" | "mock";
  readonly players: readonly EnrichedPlayer[];
}

/** Single Wikidata-enrichable input row. */
export interface SeedPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly code: string;
  readonly wikidataQid: string;
  readonly shirtNumber?: number | null;
}

/** Cached per-team scrape output, written to `data/players-cache/<code>.json`. */
export interface CachedTeamScrape {
  readonly code: string;
  readonly lastModified: string;
  readonly players: readonly EnrichedPlayer[];
}

/**
 * Whitelist of licences our renderer is allowed to display. Anything not in
 * this list gets the image dropped + a TODO breadcrumb in the credit field.
 */
export const ALLOWED_LICENCES: readonly string[] = [
  "CC0",
  "Public domain",
  "CC BY 2.0",
  "CC BY 3.0",
  "CC BY 4.0",
  "CC BY-SA 2.0",
  "CC BY-SA 3.0",
  "CC BY-SA 4.0",
];

/**
 * Case-insensitive licence-allowlist check. Wikidata's licence labels vary
 * in capitalisation and version separators (e.g. "CC-BY-SA-4.0" vs
 * "CC BY-SA 4.0"), so we normalise before comparing.
 */
export function isAllowedLicence(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const norm = raw
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  for (const allowed of ALLOWED_LICENCES) {
    const a = allowed.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
    if (norm === a) return true;
  }
  return false;
}

/** FWD/MID/DEF/GK normalisation from a Wikidata position label. */
export function normalisePosition(raw: string | null | undefined): PlayerPosition {
  if (!raw) return "MID";
  const r = raw.toLowerCase();
  if (r.includes("goalkeeper") || r === "gk") return "GK";
  if (r.includes("defender") || r.includes("back") || r === "df" || r === "def") return "DEF";
  if (r.includes("forward") || r.includes("striker") || r.includes("winger") || r === "fw" || r === "fwd") return "FWD";
  return "MID";
}
