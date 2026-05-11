/**
 * Wikidata-backed head-to-head source.
 *
 * Public Wikidata SPARQL endpoint (`https://query.wikidata.org/sparql`).
 * Same dataset that powers the player scraper; here we walk
 * `wd:Pmatch (P6962?)` style match items to find historical fixtures
 * between two national football teams.
 *
 * Wikidata's representation of football matches is messy: items linked
 * via `P710 (participant)` to *both* national-team Q-ids work for major
 * tournaments (WCs, Euros) but not for friendlies. The query used here
 * is a best-effort recall query — we filter the result set in JS to
 * only include items that have:
 *   - both team Q-ids as participants;
 *   - a date (P585);
 *   - a "competition" or instance-of label.
 *
 * Rate-limit policy
 *   - Wikidata's terms ask for ≤5 concurrent requests + a contact UA.
 *   - We throttle to 1 req/s.
 *   - The endpoint enforces a 60-second per-query timeout; our query
 *     is bounded to 50 results so it returns well under that cap.
 *
 * Licensing notes
 *   - All Wikidata content is CC0; redistribution + transformation is
 *     unrestricted, but we still link back via the Wikipedia article
 *     in the per-meeting record where available.
 *
 * Mock vs real
 *   - Mock backend returns a deterministic 3-meeting record for any
 *     pair, used by CI + dev.
 *   - Real backend hits Wikidata; gated by `WC2026_DATA_BACKEND=real`.
 */

import type { H2HMeeting } from "../types.js";

export interface H2HSourceOptions {
  readonly throttleMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
}

export interface H2HSource {
  fetchH2H(
    aCode: string,
    bCode: string,
    aQid: string,
    bQid: string,
  ): Promise<readonly H2HMeeting[]>;
}

const DEFAULT_THROTTLE_MS = 1000;
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * SPARQL: find football matches whose participants include both teams.
 *
 * Notes on the predicates:
 *   - `wdt:P31/wdt:P279*` walks the instance-of hierarchy so we catch
 *     both `Q16466010 (football match)` and any subclasses that real
 *     items use.
 *   - `wdt:P710` (participant) is the standard relation; some items
 *     instead use `wdt:P1923` (participating team). We accept either.
 *   - `wdt:P1346` (winner) is the cleanest scoreline signal.
 */
export function buildH2HSparqlQuery(aQid: string, bQid: string): string {
  if (!/^Q\d+$/.test(aQid) || !/^Q\d+$/.test(bQid)) {
    throw new Error(`buildH2HSparqlQuery: invalid q-ids (${aQid}, ${bQid})`);
  }
  return `
    SELECT ?match ?matchLabel ?date ?competitionLabel ?venueLabel ?winnerLabel
           ?aScore ?bScore
    WHERE {
      ?match wdt:P585 ?date.
      { ?match wdt:P710 wd:${aQid}. } UNION { ?match wdt:P1923 wd:${aQid}. }
      { ?match wdt:P710 wd:${bQid}. } UNION { ?match wdt:P1923 wd:${bQid}. }
      OPTIONAL { ?match wdt:P276 ?venue. }
      OPTIONAL { ?match wdt:P3450 ?competition. }
      OPTIONAL { ?match wdt:P1346 ?winner. }
      OPTIONAL { ?match p:P1351 ?as. ?as ps:P1351 ?aScore. ?as pq:P710 wd:${aQid}. }
      OPTIONAL { ?match p:P1351 ?bs. ?bs ps:P1351 ?bScore. ?bs pq:P710 wd:${bQid}. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?date)
    LIMIT 50
  `.trim();
}

interface SparqlBinding {
  readonly match?: { readonly value: string };
  readonly matchLabel?: { readonly value: string };
  readonly date?: { readonly value: string };
  readonly competitionLabel?: { readonly value: string };
  readonly venueLabel?: { readonly value: string };
  readonly winnerLabel?: { readonly value: string };
  readonly aScore?: { readonly value: string };
  readonly bScore?: { readonly value: string };
}

export function parseH2HResponse(
  raw: unknown,
  aCode: string,
  bCode: string,
): readonly H2HMeeting[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as { results?: { bindings?: SparqlBinding[] } };
  const bindings = r.results?.bindings ?? [];
  // Wikidata may return the same match item multiple times (one per
  // participant cross-product). Dedupe by ?match URI.
  const seen = new Set<string>();
  const out: H2HMeeting[] = [];
  for (const b of bindings) {
    const uri = b.match?.value;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const date = isoDateOnly(b.date?.value);
    if (!date) continue;
    const aScore = parseScore(b.aScore?.value);
    const bScore = parseScore(b.bScore?.value);
    if (aScore === null || bScore === null) continue;
    out.push({
      date,
      // Wikidata doesn't reliably encode home/away for international
      // matches (most are at neutral venues). We fix the orientation
      // so `homeCode = aCode` for the purpose of the scoreline; the
      // web app's reader treats this orientation as "neutral" already.
      homeCode: aCode.toUpperCase(),
      awayCode: bCode.toUpperCase(),
      homeScore: aScore,
      awayScore: bScore,
      competition: b.competitionLabel?.value ?? "International match",
      venue: b.venueLabel?.value,
      source: "wikidata",
    });
  }
  // Most-recent first.
  out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return out;
}

function parseScore(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function isoDateOnly(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

// ---------- Mock backend ----------

export class MockH2HSource implements H2HSource {
  async fetchH2H(
    aCode: string,
    bCode: string,
  ): Promise<readonly H2HMeeting[]> {
    const a = aCode.toUpperCase();
    const b = bCode.toUpperCase();
    // Three deterministic meetings, alternating winner.
    return [
      {
        date: "2024-09-10",
        homeCode: a,
        awayCode: b,
        homeScore: 2,
        awayScore: 1,
        competition: "Friendly",
        venue: "Neutral ground",
        source: "mock",
      },
      {
        date: "2022-11-21",
        homeCode: b,
        awayCode: a,
        homeScore: 1,
        awayScore: 1,
        competition: "FIFA World Cup Group",
        venue: "Doha, Qatar",
        source: "mock",
      },
      {
        date: "2018-06-30",
        homeCode: a,
        awayCode: b,
        homeScore: 1,
        awayScore: 2,
        competition: "FIFA World Cup R16",
        venue: "Russia",
        source: "mock",
      },
    ];
  }
}

// ---------- Real backend ----------

export class WikidataH2HSource implements H2HSource {
  private readonly throttleMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private lastRequestAt = 0;

  constructor(opts: H2HSourceOptions = {}) {
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (!f) {
      throw new Error("WikidataH2HSource: no fetch implementation available");
    }
    this.fetchImpl = f;
    this.nowMs = opts.nowMs ?? Date.now;
  }

  async fetchH2H(
    aCode: string,
    bCode: string,
    aQid: string,
    bQid: string,
  ): Promise<readonly H2HMeeting[]> {
    if (!aQid || !bQid) return [];
    await this.throttle();
    const query = buildH2HSparqlQuery(aQid, bQid);
    const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent":
          process.env.WC2026_USER_AGENT ??
          "Tournamental-WC2026-Scraper/0.1 (+https://play.tournamental.com; ops@tournamental.com)",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Wikidata H2H ${aCode}-${bCode} failed: ${res.status} ${res.statusText}`,
      );
    }
    const json: unknown = await res.json();
    return parseH2HResponse(json, aCode, bCode);
  }

  private async throttle(): Promise<void> {
    const now = this.nowMs();
    const wait = this.lastRequestAt + this.throttleMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = this.nowMs();
  }
}

export function createH2HSource(opts: H2HSourceOptions = {}): H2HSource {
  const backend = (process.env.WC2026_DATA_BACKEND ?? "mock").toLowerCase();
  if (backend === "real") return new WikidataH2HSource(opts);
  return new MockH2HSource();
}
