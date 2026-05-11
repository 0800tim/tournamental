/**
 * API-Football v3 live-data adapter.
 *
 * Endpoint shape (production):
 *   https://v3.football.api-sports.io/fixtures?live=all&league=1&season=2026
 *   https://v3.football.api-sports.io/fixtures?id={fixture_id}
 *   https://v3.football.api-sports.io/fixtures/events?fixture={fixture_id}
 *
 * Pricing (per Tim's gap list, May 2026):
 *   - Free: 100 req/day. Useful for dev only.
 *   - "Pro" ~USD 19/month: 7,500 req/day, 30s polling. Sufficient for a
 *     single-match watch-along but not concurrent matches.
 *   - "Ultra" ~USD 39/month: 75,000 req/day, 15s polling. Recommended
 *     during the group stage if SportRadar is too pricey.
 *
 * Auth header:
 *   x-apisports-key: <key>
 * Or via RapidAPI:
 *   x-rapidapi-key: <key>
 *   x-rapidapi-host: api-football-v1.p.rapidapi.com
 *
 * This file is a *stub adapter*: shape-correct request building, minimal
 * response mapping. Throws `MissingApiKeyError` on missing key.
 */

import { request } from "undici";

import { MissingApiKeyError } from "./sportradar-provider.js";
import type {
  LiveDataProvider,
  LiveFixture,
  LiveMatchState,
  LiveMatchUpdate,
  ScorerType,
} from "./types.js";

export interface ApiFootballOptions {
  readonly apiKey: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Use the RapidAPI host header instead of x-apisports-key. */
  readonly viaRapidApi?: boolean;
  /** Override fetcher (for tests). */
  readonly fetcher?: (url: string, headers: Record<string, string>) => Promise<{
    status: number;
    body: unknown;
  }>;
  /** Polling interval for `subscribeMatch` (ms). Default 30s — Pro tier. */
  readonly pollIntervalMs?: number;
  /** League id for the FIFA World Cup 2026; default 1 (api-football canonical). */
  readonly leagueId?: number;
  /** Season year. Default 2026. */
  readonly season?: number;
}

interface AfFixtureResponse {
  readonly response?: ReadonlyArray<{
    readonly fixture?: {
      readonly id?: number;
      readonly date?: string;
      readonly status?: { readonly short?: string; readonly elapsed?: number };
      readonly venue?: { readonly name?: string; readonly city?: string };
    };
    readonly teams?: {
      readonly home?: { readonly id?: number; readonly name?: string; readonly code?: string };
      readonly away?: { readonly id?: number; readonly name?: string; readonly code?: string };
    };
    readonly goals?: { readonly home?: number | null; readonly away?: number | null };
    readonly events?: ReadonlyArray<{
      readonly time?: { readonly elapsed?: number; readonly extra?: number | null };
      readonly team?: { readonly id?: number; readonly code?: string; readonly name?: string };
      readonly player?: { readonly name?: string };
      readonly assist?: { readonly name?: string | null };
      readonly type?: string; // "Goal" | "Card" | "subst"
      readonly detail?: string; // "Normal Goal" | "Penalty" | "Own Goal" | "Yellow Card" | ...
      readonly comments?: string | null;
    }>;
  }>;
}

const DEFAULT_BASE = "https://v3.football.api-sports.io";

async function defaultFetcher(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await request(url, {
    method: "GET",
    headers,
    headersTimeout: 10_000,
    bodyTimeout: 15_000,
  });
  const body = (await res.body.json()) as unknown;
  return { status: res.statusCode, body };
}

export class ApiFootballLiveDataProvider implements LiveDataProvider {
  readonly name = "apifootball";

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly viaRapidApi: boolean;
  private readonly fetcher: NonNullable<ApiFootballOptions["fetcher"]>;
  private readonly pollIntervalMs: number;
  private readonly leagueId: number;
  private readonly season: number;

  constructor(opts: ApiFootballOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.viaRapidApi = opts.viaRapidApi ?? false;
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.pollIntervalMs = Math.max(1000, opts.pollIntervalMs ?? 30_000);
    this.leagueId = opts.leagueId ?? 1;
    this.season = opts.season ?? 2026;
  }

  private requireKey(): string {
    if (!this.apiKey || this.apiKey.length === 0) {
      throw new MissingApiKeyError(this.name);
    }
    return this.apiKey;
  }

  private headers(): Record<string, string> {
    const key = this.requireKey();
    if (this.viaRapidApi) {
      return {
        "x-rapidapi-key": key,
        "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
        Accept: "application/json",
      };
    }
    return {
      "x-apisports-key": key,
      Accept: "application/json",
      "User-Agent": "vtorn-wc2026-data/0.1 (+https://play.tournamental.com)",
    };
  }

  async fetchUpcoming(limit: number): Promise<LiveFixture[]> {
    this.requireKey();
    const url =
      `${this.baseUrl}/fixtures?league=${this.leagueId}&season=${this.season}&next=${Math.max(0, limit)}`;
    const { status, body } = await this.fetcher(url, this.headers());
    if (status !== 200) {
      throw new Error(`api-football fixtures HTTP ${status}`);
    }
    const obj = body as AfFixtureResponse;
    const arr = obj.response ?? [];
    return arr.map((row) => this.mapFixtureRow(row));
  }

  async fetchMatch(matchId: string): Promise<LiveMatchState> {
    this.requireKey();
    const url = `${this.baseUrl}/fixtures?id=${encodeURIComponent(matchId)}`;
    const { status, body } = await this.fetcher(url, this.headers());
    if (status !== 200) {
      throw new Error(`api-football fixture HTTP ${status}`);
    }
    const obj = body as AfFixtureResponse;
    const row = (obj.response ?? [])[0];
    if (!row) {
      throw new Error(`api-football: no fixture for id ${matchId}`);
    }
    return this.mapState(matchId, row);
  }

  subscribeMatch(matchId: string, onUpdate: LiveMatchUpdate): () => void {
    let cancelled = false;
    let lastVersion = -1;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const state = await this.fetchMatch(matchId);
        if (state.version !== lastVersion) {
          lastVersion = state.version;
          onUpdate(state);
        }
      } catch {
        // ignore transient errors per-tick
      }
    };

    void tick();
    const handle = setInterval(() => {
      void tick();
    }, this.pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }

  // ---------- mapping ----------

  private mapFixtureRow(row: NonNullable<AfFixtureResponse["response"]>[number]): LiveFixture {
    const country = (row.fixture?.venue?.city ?? "").toLowerCase();
    const host = guessHostFromCity(country);
    return {
      matchId: String(row.fixture?.id ?? "0"),
      homeTeamId: (row.teams?.home?.code ?? row.teams?.home?.name ?? "HOM").slice(0, 3).toUpperCase(),
      awayTeamId: (row.teams?.away?.code ?? row.teams?.away?.name ?? "AWY").slice(0, 3).toUpperCase(),
      kickoffUtc: row.fixture?.date ?? new Date().toISOString(),
      host,
      venue: row.fixture?.venue?.name ?? "Unknown",
      status: mapStatusShort(row.fixture?.status?.short),
    };
  }

  private mapState(
    matchId: string,
    row: NonNullable<AfFixtureResponse["response"]>[number],
  ): LiveMatchState {
    const events = row.events ?? [];
    return {
      matchId,
      status: mapStatusShort(row.fixture?.status?.short),
      currentMinute: row.fixture?.status?.elapsed ?? 0,
      homeScore: row.goals?.home ?? 0,
      awayScore: row.goals?.away ?? 0,
      scorers: events
        .filter((e) => e.type === "Goal")
        .map((e) => ({
          teamId: (e.team?.code ?? e.team?.name ?? "UNK").slice(0, 3).toUpperCase(),
          playerName: e.player?.name ?? "Unknown",
          minute: e.time?.elapsed ?? 0,
          type: detailToScorerType(e.detail),
        })),
      latestEvents: events.slice(-20).map((e) => ({
        minute: e.time?.elapsed ?? 0,
        type: (e.type ?? "event").toLowerCase().replace(/\s+/g, "_"),
        description:
          e.comments ?? `${e.type ?? "event"} — ${e.player?.name ?? ""} (${e.time?.elapsed ?? "?"}')`,
      })),
      version: events.length,
      updatedAtUtc: new Date().toISOString(),
    };
  }
}

function detailToScorerType(detail: string | undefined): ScorerType {
  const d = (detail ?? "").toLowerCase();
  if (d.includes("penalty")) return "pen";
  if (d.includes("own")) return "og";
  return "goal";
}

function mapStatusShort(s: string | undefined): LiveMatchState["status"] {
  switch (s) {
    case "1H":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "live";
    case "HT":
      return "ht";
    case "FT":
    case "AET":
    case "PEN":
    case "AWD":
      return "final";
    case "PST":
    case "TBD":
      return "postponed";
    case "ABD":
    case "CANC":
    case "WO":
      return "abandoned";
    case "NS":
    default:
      return "scheduled";
  }
}

function guessHostFromCity(city: string): "US" | "CA" | "MX" {
  if (/toronto|vancouver/.test(city)) return "CA";
  if (/guadalajara|monterrey|mexico/.test(city)) return "MX";
  return "US";
}
