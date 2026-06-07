/**
 * Read-only data feeds for bot decision policies.
 *
 *   getOdds(matchId)             , latest Polymarket-or-cached odds
 *   getInjuries(home, away)      , stub feed (Phase 2 wires the real source)
 *   getWeather(venueId, kickoff) , stub feed (Phase 2 wires the real source)
 *
 * The shapes are documented at https://play.tournamental.com/bots/sdk
 * §6 (Live data feeds). All three calls are cheap, public, and cache
 * aggressively at the edge; calling them every minute from a swarm is
 * fine per the docs.
 *
 * `getOdds` returns the `OddsSnapshot` shape from `./types.js` plus a
 * synthesised `favourite` field so quickstart code can do
 *   `await bot.pick(m.id, odds.favourite)`
 * without re-implementing the argmax. When the upstream feed is offline
 * or the match is not yet priced, `favourite` falls back to "home_win"
 * with a `note: "no_odds"` field so callers can detect the fallback if
 * they care.
 *
 * `getInjuries` and `getWeather` are stubs in Phase 1 , the function
 * signatures are stable so SDK consumers can wire them up now and the
 * data starts flowing in Phase 2 with zero code changes.
 */

import {
  DEFAULT_BASE_URL,
  type ClientOpts,
} from "./client.js";
import type { OddsSnapshot } from "./types.js";

/** Outcome the model thinks is most likely, used by quickstart code. */
export type Favourite = "home_win" | "draw" | "away_win";

export interface OddsResult {
  /** Match id this snapshot is for. */
  readonly match_id: string;
  /** Home-win implied probability, 0..1. */
  readonly home_win: number;
  /** Draw implied probability, 0..1. Omitted for knockouts. */
  readonly draw?: number;
  /** Away-win implied probability, 0..1. */
  readonly away_win: number;
  /** Argmax of the three probabilities, lower-cased outcome string. */
  readonly favourite: Favourite;
  /** Free-form provider tag, e.g. "polymarket" or "synthetic-chalk". */
  readonly source?: string;
  /** ISO-8601 UTC time the snapshot was taken upstream. */
  readonly snapshot_at?: string;
  /** Set to "no_odds" when the feed is offline; favourite is "home_win" then. */
  readonly note?: "no_odds";
}

export interface InjuryItem {
  readonly player: string;
  readonly status: string;
  readonly expected_return: string | null;
}

export interface InjuriesResult {
  readonly home_team: string;
  readonly away_team: string;
  readonly home: { readonly out: readonly InjuryItem[]; readonly doubtful: readonly InjuryItem[] };
  readonly away: { readonly out: readonly InjuryItem[]; readonly doubtful: readonly InjuryItem[] };
  /** Provenance tag. "stub" in Phase 1, real provider id later. */
  readonly source: "stub" | string;
}

export interface WeatherResult {
  readonly venue_id: string;
  readonly kickoff_utc: string;
  readonly forecast: {
    readonly temp_c: number | null;
    readonly humidity_pct: number | null;
    readonly wind_kph: number | null;
    readonly precipitation_mm: number | null;
  };
  /** Provenance tag. "stub" in Phase 1, real provider id later. */
  readonly source: "stub" | string;
}

/** Common options for the read-only feeds. apiKey is optional , feeds are public. */
export interface FeedOpts {
  /** Base URL override (defaults to https://api.tournamental.com). */
  baseUrl?: string;
  /** Pluggable fetch for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Optional Authorization Bearer key. Public feeds work without one. */
  apiKey?: string;
}

function resolveFetch(impl?: typeof fetch): typeof fetch {
  const f = impl ?? (globalThis.fetch as typeof fetch | undefined);
  if (!f) {
    throw new Error(
      "bot-sdk: no fetch implementation available. Pass `fetchImpl` or run on Node >= 20.",
    );
  }
  return f;
}

/**
 * Argmax helper. Ties resolve in (home_win, draw, away_win) order , the
 * docs page promises a deterministic fallback to the home side.
 */
function pickFavourite(
  home: number,
  draw: number | undefined,
  away: number,
): Favourite {
  const drawValue = typeof draw === "number" ? draw : -Infinity;
  if (home >= drawValue && home >= away) return "home_win";
  if (drawValue >= away) return "draw";
  return "away_win";
}

/**
 * GET /v1/odds/<match_id>.
 *
 * Returns the latest market-implied probabilities for one match. The
 * docs promise four guaranteed fields: home_win, draw (optional),
 * away_win, favourite. The favourite is the argmax of the three so
 * quickstart code can do `await bot.pick(m.id, odds.favourite)`.
 *
 * Network failures and 404s degrade gracefully to a 50/50/0 fallback
 * (`favourite: "home_win"`, `note: "no_odds"`) so a bot that follows
 * odds blindly still submits a bracket end-to-end.
 */
export async function getOdds(
  matchId: string,
  opts: FeedOpts = {},
): Promise<OddsResult> {
  if (!matchId || typeof matchId !== "string") {
    throw new Error("bot-sdk: getOdds requires a non-empty matchId");
  }
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/v1/odds/${encodeURIComponent(matchId)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const fetcher = resolveFetch(opts.fetchImpl);

  let res: Response;
  try {
    res = await fetcher(url, { method: "GET", headers });
  } catch {
    return fallbackOdds(matchId);
  }
  if (!res.ok) {
    return fallbackOdds(matchId);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fallbackOdds(matchId);
  }

  const parsed = parseOddsPayload(matchId, body);
  if (!parsed) return fallbackOdds(matchId);
  return parsed;
}

function fallbackOdds(matchId: string): OddsResult {
  return {
    match_id: matchId,
    home_win: 0.5,
    draw: 0,
    away_win: 0.5,
    favourite: "home_win",
    source: "fallback",
    note: "no_odds",
  };
}

/**
 * Parse the loose upstream shape into the strict OddsResult contract.
 *
 * We accept two upstream shapes so we can reuse the existing
 * odds-ingest endpoints once they're proxied through:
 *
 *   1. `{ home_win, draw, away_win, favourite?, source? }` , the
 *      shape the docs page documents.
 *   2. `{ probabilities: { home_win, draw, away_win }, favourite?,
 *         source?, snapshot_at? }` , the shape in the docs example
 *      under §6.
 *
 * Either yields the same return shape.
 */
function parseOddsPayload(matchId: string, raw: unknown): OddsResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const probs =
    obj.probabilities && typeof obj.probabilities === "object"
      ? (obj.probabilities as Record<string, unknown>)
      : obj;

  const home = numeric(probs.home_win);
  const drawRaw =
    probs.draw === undefined || probs.draw === null
      ? undefined
      : numeric(probs.draw);
  const draw = drawRaw === null ? undefined : drawRaw;
  const away = numeric(probs.away_win);
  if (home == null || away == null) return null;

  const explicit =
    obj.favourite === "home_win" ||
    obj.favourite === "draw" ||
    obj.favourite === "away_win"
      ? (obj.favourite as Favourite)
      : null;
  const favourite = explicit ?? pickFavourite(home, draw, away);

  const result: OddsResult = {
    match_id:
      typeof obj.match_id === "string" && obj.match_id.length > 0
        ? obj.match_id
        : matchId,
    home_win: home,
    away_win: away,
    favourite,
    ...(draw !== undefined ? { draw } : {}),
    ...(typeof obj.source === "string" ? { source: obj.source } : {}),
    ...(typeof obj.snapshot_at === "string"
      ? { snapshot_at: obj.snapshot_at }
      : {}),
  };
  return result;
}

function numeric(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Build a typed OddsSnapshot from an OddsResult, for callers that want
 * to round-trip through the existing types.OddsSnapshot surface.
 */
export function toOddsSnapshot(result: OddsResult): OddsSnapshot {
  return {
    match_id: result.match_id,
    home_win: result.home_win,
    draw: result.draw ?? 0,
    away_win: result.away_win,
    ...(result.source ? { source: result.source } : {}),
  };
}

/**
 * GET injuries for the home + away teams of a match.
 *
 * Phase 1: stub. Returns an empty injury list for both sides so a bot's
 * decision policy can call this from day one without a feature flag.
 * The function signature is stable, so when Phase 2 wires the upstream
 * provider (Footystats / Sportmonks) the data starts flowing with zero
 * caller-side code changes.
 *
 * Tracking issue: https://github.com/0800tim/tournamental/issues
 */
export async function getInjuries(
  homeCode: string,
  awayCode: string,
  _opts: FeedOpts = {},
): Promise<InjuriesResult> {
  if (!homeCode || !awayCode) {
    throw new Error("bot-sdk: getInjuries requires homeCode and awayCode");
  }
  return {
    home_team: homeCode,
    away_team: awayCode,
    home: { out: [], doubtful: [] },
    away: { out: [], doubtful: [] },
    source: "stub",
  };
}

/**
 * GET weather for a venue + kickoff UTC timestamp.
 *
 * Phase 1: stub. Returns a forecast object with every field set to null
 * so caller code can safely render placeholders. Phase 2 wires the real
 * Open-Meteo (or equivalent) provider behind the same signature.
 *
 * Tracking issue: https://github.com/0800tim/tournamental/issues
 */
export async function getWeather(
  venueId: string,
  kickoffUtc: string,
  _opts: FeedOpts = {},
): Promise<WeatherResult> {
  if (!venueId) {
    throw new Error("bot-sdk: getWeather requires a venueId");
  }
  if (!kickoffUtc) {
    throw new Error("bot-sdk: getWeather requires a kickoffUtc string");
  }
  return {
    venue_id: venueId,
    kickoff_utc: kickoffUtc,
    forecast: {
      temp_c: null,
      humidity_pct: null,
      wind_kph: null,
      precipitation_mm: null,
    },
    source: "stub",
  };
}
