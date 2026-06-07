/**
 * Helpers for fetching the live match catalogue and current Polymarket odds.
 *
 * Two data sources:
 *   1. Tournamental's own match catalogue API (`/v1/matches`). This is the
 *      authoritative list Sage iterates: ids, codes, kickoff times.
 *   2. The Polymarket-fed odds endpoint at `/v1/odds/snapshot` (served by
 *      `apps/odds-ingest`). Sage reads this once per cron tick and slices it
 *      per match. Falling back to the public Polymarket Gamma API directly
 *      keeps Sage usable as a standalone reference even if the ingest
 *      service is offline.
 *
 * No retries here. The cron tick repeats every 6 hours; transient failures
 * naturally heal. The bot-sdk's HTTP client already retries on bulk submit.
 */

import type { MatchSpec, OddsSnapshot } from "@tournamental/bot-sdk";

export const DEFAULT_API_BASE = "https://api.tournamental.com";
export const DEFAULT_ODDS_BASE = "https://odds.tournamental.com";
export const DEFAULT_TOURNAMENT_ID = "fifa-wc-2026";

export interface ApiOpts {
  /** Base URL for the Tournamental public API. Default: api.tournamental.com. */
  apiBase?: string;
  /** Base URL for the odds-ingest service. Default: odds.tournamental.com. */
  oddsBase?: string;
  /** Tournament filter. Default: fifa-wc-2026. */
  tournamentId?: string;
  /** Pluggable fetch for tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
}

interface RawMatchListResponse {
  matches?: MatchSpec[];
}

interface RawSnapshotResponse {
  matches?: {
    matchNo: string;
    homeWin?: number;
    draw?: number;
    awayWin?: number;
    source?: string;
  }[];
  probabilities?: Record<string, Record<string, number>>;
  ts?: number;
}

/**
 * Pull the tournament's match catalogue. Returns an empty list on any
 * failure (network, non-200, bad JSON). The caller decides whether to
 * abort the tick or proceed with zero matches (we log + skip).
 */
export async function fetchMatches(opts: ApiOpts = {}): Promise<MatchSpec[]> {
  const fetcher = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const base = opts.apiBase ?? DEFAULT_API_BASE;
  const tournament = opts.tournamentId ?? DEFAULT_TOURNAMENT_ID;
  const url = `${base}/v1/matches?tournament_id=${encodeURIComponent(tournament)}`;
  try {
    const res = await fetcher(url, { method: "GET" });
    if (!res.ok) return [];
    const body = (await res.json()) as RawMatchListResponse;
    return Array.isArray(body.matches) ? body.matches : [];
  } catch {
    return [];
  }
}

/**
 * Pull every match's current implied probabilities in one request and
 * return a map keyed by `MatchSpec.id`. Handles the two response shapes
 * that the ingest service emits (see apps/odds-ingest/src/api.ts and the
 * Next adapter in apps/web/app/api/odds/snapshot).
 */
export async function fetchOddsSnapshot(
  opts: ApiOpts = {},
): Promise<Map<string, OddsSnapshot>> {
  const fetcher = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const base = opts.oddsBase ?? DEFAULT_ODDS_BASE;
  const url = `${base}/v1/odds/snapshot`;
  const out = new Map<string, OddsSnapshot>();
  try {
    const res = await fetcher(url, { method: "GET" });
    if (!res.ok) return out;
    const body = (await res.json()) as RawSnapshotResponse;
    if (Array.isArray(body.matches)) {
      for (const row of body.matches) {
        if (
          typeof row.homeWin === "number" &&
          typeof row.draw === "number" &&
          typeof row.awayWin === "number"
        ) {
          out.set(String(row.matchNo), {
            match_id: String(row.matchNo),
            home_win: row.homeWin,
            draw: row.draw,
            away_win: row.awayWin,
            source: row.source ?? "polymarket",
          });
        }
      }
      return out;
    }
    if (body.probabilities) {
      for (const [marketId, probs] of Object.entries(body.probabilities)) {
        // marketId of the form "wc2026:match:12" -> id "12".
        const m = marketId.match(/match:(\d+)/);
        if (!m) continue;
        const id = m[1]!;
        const draw = probs["Draw"] ?? probs["draw"] ?? 0;
        const others = Object.entries(probs).filter(
          ([k]) => k !== "Draw" && k !== "draw",
        );
        if (others.length !== 2) continue;
        const [home, away] = others;
        out.set(id, {
          match_id: id,
          home_win: home![1],
          draw,
          away_win: away![1],
          source: "polymarket",
        });
      }
    }
  } catch {
    /* fall through, return whatever we built */
  }
  return out;
}

/**
 * Select the next matches Sage should opine on. Filters out anything that has
 * already kicked off (picks are locked at kickoff) and caps the batch so the
 * Claude bill stays predictable. Returns a stable order (ascending kickoff).
 */
export function selectUpcoming(
  matches: MatchSpec[],
  now: Date = new Date(),
  limit = 24,
): MatchSpec[] {
  const horizon = matches
    .filter((m) => {
      const t = Date.parse(m.kickoff_utc);
      return Number.isFinite(t) && t > now.getTime();
    })
    .sort((a, b) => Date.parse(a.kickoff_utc) - Date.parse(b.kickoff_utc));
  return horizon.slice(0, limit);
}
