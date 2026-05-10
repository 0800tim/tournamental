/**
 * Wikidata-backed player enrichment scraper.
 *
 * Queries the public Wikidata SPARQL endpoint at
 * `https://query.wikidata.org/sparql` for each (Q-id, FIFA code) pair and
 * returns enriched player records. Wikidata's `image` property (P18)
 * resolves to a Wikimedia Commons file; we render that as a thumbnail via
 * `Special:FilePath/<file>?width=400px`.
 *
 * The module exports two backends:
 *
 *   - `MockScraper` — deterministic 22-per-team fixture, used by default in
 *     CI and dev. No network.
 *   - `WikidataScraper` — real backend, gated behind
 *     `WC2026_DATA_BACKEND=real`. Polite throttle (1 req/s) and per-team
 *     file cache at `data/players-cache/<code>.json`.
 *
 * Why a TS scraper alongside the existing Python `wc2026_data` package?
 * The Python code builds *canonical* fixtures + roster lists from
 * hand-curated snapshots (deterministic, audit-friendly). This TS module is
 * the *web-facing* enrichment path — it adds image URLs, dobs, clubs etc.
 * specifically for the renderer, with an in-process cache and an env-gated
 * real backend that's safe to ship in CI.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type CachedTeamScrape,
  type EnrichedPlayer,
  type PlayerPosition,
  type SeedPlayer,
  isAllowedLicence,
  normalisePosition,
} from "./types.js";

// ---------- public API ----------

export interface ScrapeOptions {
  /** Override the cache directory (tests use this). */
  readonly cacheDir?: string;
  /**
   * Maximum age (ms) of a cached entry before it's refetched. Default 7
   * days. Set to 0 to force refresh on every call.
   */
  readonly maxCacheAgeMs?: number;
  /** Throttle (ms) between SPARQL requests. Default 1000 (1 req/s). */
  readonly throttleMs?: number;
  /**
   * Override the `fetch` implementation. Tests inject a deterministic
   * mock; production passes nothing and uses globalThis.fetch.
   */
  readonly fetchImpl?: typeof fetch;
  /** Override `Date.now()` for deterministic tests. */
  readonly nowMs?: () => number;
}

export interface PlayerScraper {
  scrapeTeam(code: string, seed: readonly SeedPlayer[]): Promise<readonly EnrichedPlayer[]>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = .../apps/wc2026-data/src/players → up two = apps/wc2026-data
const DEFAULT_CACHE_DIR = resolve(HERE, "..", "..", "data", "players-cache");
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_THROTTLE_MS = 1000;
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

// ---------- helpers (pure) ----------

/**
 * Convert `data/fifa-wc-2026/players.json` style player_id (`ARG_MESSI`)
 * into the public id used in `players-2026.json` (`ARG-MESSI`).
 */
export function publicIdFromPlayerId(playerId: string): string {
  // ARG_DI_MARIA → ARG-DI-MARIA → ARG-DIMARIA?  Keep the underscores as
  // dashes for readability in URLs; the suffix may legitimately contain
  // multiple words (e.g. MAC_ALLISTER → MAC-ALLISTER).
  return playerId.replace(/_/g, "-").toUpperCase();
}

/** Build a Wikimedia Commons thumbnail URL from a `File:` page name. */
export function commonsThumbUrl(fileName: string, width = 400): string {
  // Wikidata stores the *filename* (no `File:` prefix) in P18 internally,
  // but its SPARQL response returns a fully-URL-encoded path like
  // `http://commons.wikimedia.org/wiki/Special:FilePath/Lionel%20Messi.jpg`.
  // When we `.split("/").pop()` we get the already-encoded filename;
  // re-encoding would double-encode, so we *decode first*, then re-encode
  // with spaces preserved as `_` (the canonical form).
  const stripped = fileName.replace(/^File:/i, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(stripped);
  } catch {
    decoded = stripped;
  }
  const enc = encodeURIComponent(decoded).replace(/%20/g, "_");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=${width}px`;
}

/**
 * SPARQL query for a list of player Q-ids.
 *
 * Returns: name, full name, dob, position label, current club label,
 * P18 (image filename), Wikipedia article URL.
 *
 * The raw query is kept in this module (rather than a separate `.rq`
 * file) so it's trivially testable. Builders override the fetch
 * implementation in tests; the query string is a stable input.
 */
export function buildSparqlQuery(qids: readonly string[]): string {
  if (qids.length === 0) {
    throw new Error("buildSparqlQuery: empty qids");
  }
  // Defensive: every Q-id must match `Q\d+`.
  for (const q of qids) {
    if (!/^Q\d+$/.test(q)) {
      throw new Error(`buildSparqlQuery: invalid q-id ${q}`);
    }
  }
  const values = qids.map((q) => `wd:${q}`).join(" ");
  // Notes:
  //   - P54 (member of sports team) is a property with qualifiers; we
  //     filter the *current* club via the qualifier-based pattern
  //     `?player p:P54 ?cs. ?cs ps:P54 ?club. FILTER NOT EXISTS { ?cs pq:P582 ?end }`
  //     i.e. "the team statement has no end-time qualifier" → still active.
  //   - The SERVICE wikibase:label block resolves `?clubLabel` and
  //     `?positionLabel` automatically when the variable name follows the
  //     `<X>Label` convention.
  return `
    SELECT ?player ?playerLabel ?fullName ?dob ?image
           ?position ?positionLabel ?club ?clubLabel ?article
    WHERE {
      VALUES ?player { ${values} }
      OPTIONAL { ?player wdt:P1477 ?fullName. }
      OPTIONAL { ?player wdt:P569 ?dob. }
      OPTIONAL { ?player wdt:P18 ?image. }
      OPTIONAL { ?player wdt:P413 ?position. }
      OPTIONAL {
        ?player p:P54 ?cs.
        ?cs ps:P54 ?club.
        FILTER NOT EXISTS { ?cs pq:P582 ?end. }
      }
      OPTIONAL {
        ?article schema:about ?player ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `.trim();
}

/**
 * Parse a Wikidata SPARQL JSON response into enriched-player records.
 * Pure function; no I/O.
 */
export function parseSparqlResponse(
  raw: unknown,
  seedByQid: ReadonlyMap<string, SeedPlayer>,
): readonly EnrichedPlayer[] {
  const out: EnrichedPlayer[] = [];
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { results?: { bindings?: SparqlBinding[] } };
  const bindings = r.results?.bindings ?? [];
  // Wikidata returns one row per (player × position × club …) cross product;
  // collapse by player Q-id, picking the first non-null for each field.
  const merged = new Map<string, MergedRow>();
  for (const b of bindings) {
    const player = b.player?.value;
    if (!player) continue;
    const qid = player.split("/").pop() ?? "";
    if (!seedByQid.has(qid)) continue;
    const cur = merged.get(qid) ?? { qid, fields: {}, positionLabels: [] };
    pickFirst(cur.fields, "name", b.playerLabel?.value);
    pickFirst(cur.fields, "fullName", b.fullName?.value);
    pickFirst(cur.fields, "dob", isoDateOnly(b.dob?.value));
    pickFirst(cur.fields, "imageFilename", b.image?.value?.split("/").pop());
    pickFirst(cur.fields, "club", b.clubLabel?.value);
    pickFirst(cur.fields, "article", b.article?.value);
    if (b.positionLabel?.value) {
      cur.positionLabels.push(b.positionLabel.value);
    }
    merged.set(qid, cur);
  }
  for (const seed of seedByQid.values()) {
    const m = merged.get(seed.wikidataQid);
    const f = m?.fields ?? {};
    const position: PlayerPosition = pickBestPosition(m?.positionLabels ?? []);
    const enriched: EnrichedPlayer = {
      id: publicIdFromPlayerId(seed.playerId),
      wikidataQid: seed.wikidataQid,
      name: f.name ?? seed.name,
      fullName: f.fullName ?? null,
      code: seed.code,
      shirtNumber: seed.shirtNumber ?? null,
      position,
      dob: f.dob ?? null,
      club: f.club ?? null,
      clubLogo: null,
      imageUrl: f.imageFilename ? commonsThumbUrl(f.imageFilename) : null,
      imageCredit: f.imageFilename ? `Wikimedia Commons · CC BY-SA 4.0` : null,
      imageLicence: f.imageFilename ? "CC BY-SA 4.0" : null,
      captain: false,
      wikipediaUrl: f.article ?? null,
    };
    // Licence safety: if we couldn't determine a clean licence, drop the
    // image URL but keep the player record (face avatar fallback handles
    // the missing image).
    if (enriched.imageUrl && !isAllowedLicence(enriched.imageLicence)) {
      out.push({
        ...enriched,
        imageUrl: null,
        imageCredit: `TODO: licence not in allowlist (${enriched.imageLicence ?? "unknown"})`,
        imageLicence: null,
      });
    } else {
      out.push(enriched);
    }
  }
  return out;
}

interface SparqlBinding {
  readonly player?: { readonly value: string };
  readonly playerLabel?: { readonly value: string };
  readonly fullName?: { readonly value: string };
  readonly dob?: { readonly value: string };
  readonly image?: { readonly value: string };
  readonly positionLabel?: { readonly value: string };
  readonly clubLabel?: { readonly value: string };
  readonly article?: { readonly value: string };
}

interface MergedRow {
  readonly qid: string;
  fields: {
    name?: string;
    fullName?: string;
    dob?: string;
    imageFilename?: string;
    position?: string;
    club?: string;
    article?: string;
  };
  /** Every position label seen across the cross-product, in order. */
  readonly positionLabels: string[];
}

function pickFirst<K extends string>(
  obj: Partial<Record<K, string>>,
  key: K,
  value: string | undefined | null,
): void {
  if (obj[key]) return;
  if (!value) return;
  obj[key] = value;
}

/**
 * Resolve the best PlayerPosition from a Wikidata cross-product. Wikidata
 * lists multiple positions for many players (Messi: midfielder + forward),
 * so we score by specificity (FWD/GK > DEF > MID) and pick the highest.
 *
 * Returns `MID` if none match (Wikidata's `MID` is also our default
 * fallback when nothing is known).
 */
export function pickBestPosition(labels: readonly string[]): PlayerPosition {
  if (labels.length === 0) return "MID";
  const positions = labels.map(normalisePosition);
  // FWD wins (most "exciting" attacking signal); GK next (highly specific
  // and rarely combined); DEF; MID is the null-fallback so it loses ties.
  const order: PlayerPosition[] = ["FWD", "GK", "DEF", "MID"];
  for (const candidate of order) {
    if (positions.includes(candidate)) return candidate;
  }
  return "MID";
}

function isoDateOnly(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // Wikidata returns full ISO timestamps (e.g. 1987-06-24T00:00:00Z); we
  // only want the date part. Reject anything malformed.
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

// ---------- Mock backend ----------

/**
 * Deterministic mock backend. Returns one enriched record per seed entry,
 * with synthesised dob + position rotated through GK/DEF/MID/FWD so the
 * output is realistic enough for tests + dev.
 */
export class MockScraper implements PlayerScraper {
  async scrapeTeam(
    code: string,
    seed: readonly SeedPlayer[],
  ): Promise<readonly EnrichedPlayer[]> {
    return seed.map((s, idx) => {
      const positions: PlayerPosition[] = ["GK", "DEF", "MID", "FWD"];
      const position = positions[idx % positions.length] ?? "MID";
      // Synthesise a dob: 1990-01-01 + (idx * 30 days) so it's stable and
      // diverse across the squad.
      const base = new Date("1990-01-01T00:00:00Z").getTime();
      const dob = new Date(base + idx * 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return {
        id: publicIdFromPlayerId(s.playerId),
        wikidataQid: s.wikidataQid,
        name: s.name,
        fullName: s.name,
        code: s.code,
        shirtNumber: s.shirtNumber ?? idx + 1,
        position,
        dob,
        club: `Mock FC ${s.code}`,
        clubLogo: null,
        imageUrl: null,
        imageCredit: null,
        imageLicence: null,
        captain: idx === 0,
        wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.name.replace(/ /g, "_"))}`,
      };
    });
  }
}

// ---------- Real backend ----------

/**
 * Real Wikidata SPARQL backend. Throttles 1 req/s and caches per-team
 * results to `data/players-cache/<code>.json`.
 *
 * Construction does not hit the network. `scrapeTeam` does, unless the
 * cache is fresh.
 */
export class WikidataScraper implements PlayerScraper {
  private readonly cacheDir: string;
  private readonly maxAgeMs: number;
  private readonly throttleMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private lastRequestAt = 0;

  constructor(opts: ScrapeOptions = {}) {
    this.cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
    this.maxAgeMs = opts.maxCacheAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (!f) {
      throw new Error("WikidataScraper: no fetch implementation available");
    }
    this.fetchImpl = f;
    this.nowMs = opts.nowMs ?? Date.now;
  }

  async scrapeTeam(
    code: string,
    seed: readonly SeedPlayer[],
  ): Promise<readonly EnrichedPlayer[]> {
    const cached = this.readCache(code);
    if (cached) {
      const age = this.nowMs() - Date.parse(cached.lastModified);
      if (age < this.maxAgeMs) return cached.players;
    }
    if (seed.length === 0) {
      // Nothing to scrape; persist an empty cache to avoid re-tripping.
      const empty: CachedTeamScrape = {
        code,
        lastModified: new Date(this.nowMs()).toISOString(),
        players: [],
      };
      this.writeCache(code, empty);
      return [];
    }
    await this.throttle();
    const qids = seed.map((s) => s.wikidataQid);
    const query = buildSparqlQuery(qids);
    const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: "application/sparql-results+json",
        // Wikidata's etiquette page asks for a contact UA on every
        // automated query. Override via env if you fork this.
        "User-Agent":
          process.env.WC2026_USER_AGENT ??
          "Tournamental-WC2026-Scraper/0.1 (+https://vtorn.aiva.nz; ops@tournamental.com)",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Wikidata SPARQL request failed: ${res.status} ${res.statusText}`,
      );
    }
    const json: unknown = await res.json();
    const seedByQid = new Map<string, SeedPlayer>();
    for (const s of seed) seedByQid.set(s.wikidataQid, s);
    const players = parseSparqlResponse(json, seedByQid);
    const out: CachedTeamScrape = {
      code,
      lastModified: new Date(this.nowMs()).toISOString(),
      players,
    };
    this.writeCache(code, out);
    return players;
  }

  private async throttle(): Promise<void> {
    const now = this.nowMs();
    const wait = this.lastRequestAt + this.throttleMs - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt = this.nowMs();
  }

  private cacheFile(code: string): string {
    return resolve(this.cacheDir, `${code.toLowerCase()}.json`);
  }

  private readCache(code: string): CachedTeamScrape | null {
    const path = this.cacheFile(code);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as CachedTeamScrape;
      if (!parsed?.code || !parsed?.lastModified) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private writeCache(code: string, payload: CachedTeamScrape): void {
    const path = this.cacheFile(code);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }
}

/**
 * Default-export factory: choose the backend based on
 * `WC2026_DATA_BACKEND`. CI + dev get Mock; opt-in to real with
 * `WC2026_DATA_BACKEND=real`.
 *
 * The factory throws if `=real` is set but no global `fetch` is
 * available (Node 18+ ships it; tests can override).
 */
export function createScraper(opts: ScrapeOptions = {}): PlayerScraper {
  const backend = (process.env.WC2026_DATA_BACKEND ?? "mock").toLowerCase();
  if (backend === "real") {
    if (!opts.fetchImpl && !globalThis.fetch) {
      throw new Error(
        "WC2026_DATA_BACKEND=real requires Node 18+ (global fetch) or an injected fetch impl",
      );
    }
    return new WikidataScraper(opts);
  }
  return new MockScraper();
}
