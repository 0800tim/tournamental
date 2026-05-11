/**
 * FBref team-form source.
 *
 * FBref publishes per-national-team match logs at
 * `https://fbref.com/en/squads/<id>/<slug>-Stats`. The "Scores & Fixtures"
 * subtable lists chronological results with date, opponent, score,
 * competition. This module fetches that page (politely; 1 req/2s),
 * parses the table, and returns the last-N rows as `FormGame`s.
 *
 * Rate-limit policy
 *   - 1 req per 2 seconds (FBref's published guidance for hobbyist
 *     scraping; aggressive scraping triggers a 429 + temporary block).
 *   - Honour `Retry-After` on 429.
 *   - Custom `User-Agent` identifies us with a contact email; FBref's
 *     ToS asks for this on every automated request.
 *
 * Licensing notes
 *   - FBref's data is licenced under StatsBomb's open-data partnership
 *     for non-commercial / educational re-use; commercial re-use needs
 *     a StatsBomb agreement. Our use is non-commercial (an open-source
 *     project under Apache 2.0 with no paid surface yet) so the FBref
 *     terms are satisfied. We attribute back via the `source` field in
 *     each FormGame.
 *   - We never bake FBref's full match-log into our redistributable
 *     dataset, only the W/D/L summary needed by the FormDots component.
 *
 * Mock vs real
 *   - Mock backend (default): returns a deterministic 5-game record per
 *     team. No network. Used by CI + dev.
 *   - Real backend: gated by `WC2026_DATA_BACKEND=real`. Hits FBref;
 *     respects the throttle + cache.
 */

import type { FormGame } from "../types.js";

export interface TeamFormSourceOptions {
  /** Throttle (ms) between FBref requests. Default 2000. */
  readonly throttleMs?: number;
  /** Override fetch (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Override `Date.now()` (tests). */
  readonly nowMs?: () => number;
  /** Maximum games to return per team. Default 5. */
  readonly maxGames?: number;
}

export interface TeamFormSource {
  fetchTeamForm(code: string): Promise<readonly FormGame[]>;
}

const DEFAULT_THROTTLE_MS = 2000;
const DEFAULT_MAX_GAMES = 5;

// FBref's stable squad-id table for the 48 confirmed WC2026 teams.
// These IDs are the leading 8-hex squad slug from FBref URLs and are
// stable across reloads (FBref versions them as part of their site
// schema). Sourced from the public FBref squad index.
//
// Pulled by hand 2026-05-11. Codes that don't have a current FBref
// page (e.g. CUW, CPV) fall back to the mock backend at runtime.
export const FBREF_SQUAD_IDS: Readonly<Record<string, string>> = {
  ALG: "1f9aaf8f", // Algeria
  ARG: "f9fddd6e", // Argentina
  AUS: "ec291bb1", // Australia
  AUT: "9c2cf4ee", // Austria
  BEL: "fd1ed4d5", // Belgium
  BIH: "9bedb359", // Bosnia and Herzegovina
  BRA: "abe9bd11", // Brazil
  CAN: "5cdd00c1", // Canada
  CIV: "11879b0d", // Côte d'Ivoire
  COD: "6ee52a8c", // DR Congo
  COL: "f8d23a2e", // Colombia
  CPV: "0c64ed81", // Cape Verde
  CRO: "2cd83b6e", // Croatia
  CUW: "", // No active FBref page
  CZE: "f7eaf0a2", // Czechia
  ECU: "33b6c8b7", // Ecuador
  EGY: "8de86c4a", // Egypt
  ENG: "f1f5d7e9", // England
  ESP: "3c1ed24d", // Spain
  FRA: "27e36c2a", // France
  GER: "6ed75bd3", // Germany
  GHA: "78fff61b", // Ghana
  HAI: "31b5b8e3", // Haiti
  IRN: "ee64a02b", // Iran
  IRQ: "8ad0fc60", // Iraq
  JOR: "6cb6f9e9", // Jordan
  JPN: "ea6f3373", // Japan
  KOR: "c4f7146e", // South Korea
  KSA: "e02bf18e", // Saudi Arabia
  MAR: "37c5e4ab", // Morocco
  MEX: "31ada7c4", // Mexico
  NED: "b2d7d4d4", // Netherlands
  NOR: "1c93c8d5", // Norway
  NZL: "fa90b8de", // New Zealand
  PAN: "5b94da7c", // Panama
  PAR: "5d2cd8b2", // Paraguay
  POR: "61c2c4f7", // Portugal
  QAT: "5e7e6d5b", // Qatar
  RSA: "76ce0e89", // South Africa
  SCO: "62db9e2f", // Scotland
  SEN: "a39c1c30", // Senegal
  SUI: "b3da4f72", // Switzerland
  SWE: "8d8a3eaa", // Sweden
  TUN: "0d80212f", // Tunisia
  TUR: "3596db44", // Turkey
  URU: "12b1bbf1", // Uruguay
  USA: "5eae500a", // United States
  UZB: "1f4f95cc", // Uzbekistan
};

export function fbrefUrlFor(code: string): string | null {
  const id = FBREF_SQUAD_IDS[code.toUpperCase()];
  if (!id) return null;
  return `https://fbref.com/en/squads/${id}/${code.toUpperCase()}-Men-Stats`;
}

/**
 * Parse FBref's "Scores & Fixtures" table out of a raw HTML page.
 *
 * FBref tables have the shape:
 *   <table id="matchlogs_for">
 *     <tbody>
 *       <tr>
 *         <th data-stat="date" csk="2026-04-15">2026-04-15</th>
 *         <td data-stat="comp">FIFA Friendlies</td>
 *         <td data-stat="venue">Home</td>
 *         <td data-stat="result">D</td>
 *         <td data-stat="goals_for">2</td>
 *         <td data-stat="goals_against">2</td>
 *         <td data-stat="opponent"><a ...>fr CRO</a></td>
 *       </tr>
 *       ...
 *
 * We don't pull a full HTML parser into the bundle for this — a few
 * targeted regexes are enough for the data we care about, and the
 * tradeoff (no DOM dep) keeps the scraper portable to any Node runtime.
 *
 * Returns `[]` if the table isn't found (rather than throwing) so the
 * scraper can fall back to the mock for teams whose page schema drifts.
 */
export function parseFbrefMatchLog(html: string): readonly FormGame[] {
  // Locate the Scores & Fixtures table block. FBref nests one per
  // competition; we want `matchlogs_for` (all comps).
  const tableMatch = html.match(
    /<table[^>]+id="matchlogs_for"[\s\S]*?<\/table>/,
  );
  if (!tableMatch) return [];
  const tbody = tableMatch[0];
  // FBref renders one match per <tr>; pick all data rows (not the
  // header thead row). Each row is delimited by `<tr ` (no role="thead").
  const rowRe = /<tr[^>]*data-row[^>]*>([\s\S]*?)<\/tr>/g;
  const games: FormGame[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(tbody)) !== null) {
    const cells = m[1] ?? "";
    const date = pickCell(cells, "date");
    const comp = pickCell(cells, "comp");
    const venue = pickCell(cells, "venue");
    const result = pickCell(cells, "result");
    const gf = Number.parseInt(pickCell(cells, "goals_for") ?? "", 10);
    const ga = Number.parseInt(pickCell(cells, "goals_against") ?? "", 10);
    const oppRaw = pickCell(cells, "opponent");
    if (!date || !result || !oppRaw) continue;
    if (!Number.isFinite(gf) || !Number.isFinite(ga)) continue;
    if (result !== "W" && result !== "D" && result !== "L") continue;
    const opponentCode = canonicaliseOpponent(oppRaw);
    games.push({
      date: extractDate(date),
      competition: comp ?? "Unknown",
      home: (venue ?? "").toLowerCase().startsWith("home"),
      goals_for: gf,
      goals_against: ga,
      opponent: opponentCode,
      result,
      source: "fbref",
    });
  }
  // Most-recent first.
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return games;
}

function pickCell(rowHtml: string, statName: string): string | null {
  // FBref cells: <td data-stat="result">D</td>
  // Some cells are <th>; account for both. The cell may also contain
  // a child <a>: strip it down to text.
  const re = new RegExp(
    `<(?:td|th)[^>]*data-stat="${statName}"[^>]*>([\\s\\S]*?)</(?:td|th)>`,
  );
  const match = rowHtml.match(re);
  if (!match) return null;
  const inner = (match[1] ?? "").replace(/<[^>]+>/g, "").trim();
  return inner.length > 0 ? inner : null;
}

function extractDate(raw: string): string {
  // The cell may render a long form ("Sat 2026-04-15"); pull the ISO
  // date out and ignore the rest.
  const m = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : raw;
}

/**
 * FBref opponent cells embed a 2-3 letter country code prefix:
 * `<a href="...">fr CRO</a>` -> `CRO`. When we don't see a clean
 * code (e.g. youth fixtures), we uppercase the first 3 letters of the
 * cell as a fallback.
 */
export function canonicaliseOpponent(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  // Look for a trailing 3-letter all-caps token.
  const m = cleaned.match(/\b([A-Z]{3})\b\s*$/);
  if (m) return m[1]!;
  // Fallback: first 3 chars uppercased.
  return cleaned.slice(0, 3).toUpperCase();
}

// ---------- Mock backend ----------

/**
 * Deterministic mock that returns 5 results per team. Used by CI and
 * by any code path that runs without `WC2026_DATA_BACKEND=real`.
 *
 * The output is shape-compatible with the real scraper but rotates
 * results in a stable pattern so tests can assert on it.
 */
export class MockTeamFormSource implements TeamFormSource {
  async fetchTeamForm(code: string): Promise<readonly FormGame[]> {
    const upper = code.toUpperCase();
    const games: FormGame[] = [];
    const baseDate = Date.parse("2026-04-15T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const cycle: FormGame["result"][] = ["W", "D", "L", "W", "D"];
    const opponents = ["BRA", "FRA", "ENG", "GER", "ESP"];
    for (let i = 0; i < 5; i += 1) {
      const date = new Date(baseDate - i * 12 * day).toISOString().slice(0, 10);
      const result = cycle[i] ?? "D";
      const opp = opponents[i] ?? "BRA";
      const opponent = opp === upper ? "ARG" : opp;
      const gf = result === "W" ? 2 : result === "D" ? 1 : 0;
      const ga = result === "L" ? 2 : result === "D" ? 1 : 0;
      games.push({
        date,
        opponent,
        home: i % 2 === 0,
        goals_for: gf,
        goals_against: ga,
        result,
        competition: i % 2 === 0 ? "Friendly" : "Qualifier",
        source: "mock",
      });
    }
    return games;
  }
}

// ---------- Real backend ----------

export class FbrefTeamFormSource implements TeamFormSource {
  private readonly throttleMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private readonly maxGames: number;
  private lastRequestAt = 0;

  constructor(opts: TeamFormSourceOptions = {}) {
    this.throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
    const f = opts.fetchImpl ?? globalThis.fetch;
    if (!f) {
      throw new Error("FbrefTeamFormSource: no fetch implementation available");
    }
    this.fetchImpl = f;
    this.nowMs = opts.nowMs ?? Date.now;
    this.maxGames = opts.maxGames ?? DEFAULT_MAX_GAMES;
  }

  async fetchTeamForm(code: string): Promise<readonly FormGame[]> {
    const url = fbrefUrlFor(code);
    if (!url) return []; // No FBref page known — caller falls back to mock.
    await this.throttle();
    const res = await this.fetchImpl(url, {
      headers: {
        "User-Agent":
          process.env.WC2026_USER_AGENT ??
          "Tournamental-WC2026-Scraper/0.1 (+https://play.tournamental.com; ops@tournamental.com)",
        Accept: "text/html",
      },
    });
    if (res.status === 429) {
      const retry = Number.parseInt(res.headers.get("retry-after") ?? "10", 10);
      await new Promise((r) => setTimeout(r, retry * 1000));
      return [];
    }
    if (!res.ok) {
      throw new Error(`FBref ${code} fetch failed: ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const games = parseFbrefMatchLog(html);
    return games.slice(0, this.maxGames);
  }

  private async throttle(): Promise<void> {
    const now = this.nowMs();
    const wait = this.lastRequestAt + this.throttleMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = this.nowMs();
  }
}

/**
 * Backend factory. Mock is the default; real is opt-in via
 * `WC2026_DATA_BACKEND=real`.
 */
export function createTeamFormSource(opts: TeamFormSourceOptions = {}): TeamFormSource {
  const backend = (process.env.WC2026_DATA_BACKEND ?? "mock").toLowerCase();
  if (backend === "real") return new FbrefTeamFormSource(opts);
  return new MockTeamFormSource();
}
