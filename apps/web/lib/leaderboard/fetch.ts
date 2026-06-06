/**
 * Leaderboard fetch helpers — talk to the game service's
 *
 *   GET  /v1/leaderboard/:tournament_id
 *   GET  /v1/leaderboard/:tournament_id/syndicate/:syndicate_id
 *
 * routes, exposed via NEXT_PUBLIC_GAME_API_URL (same base used by
 * `lib/bracket/api.ts`). Both return up to 100 ranked rows, cached
 * server-side for 30s + SWR. Rows surface the user's opaque HMAC
 * handle (SEC-BRK-06), their score_total, and the new
 * `matches_available_to_user` denominator (Tim 2026-06-07).
 */

import { GAME_API_BASE } from "@/lib/bracket/api";

/** A single leaderboard row as returned by the game service. */
export interface LeaderboardRow {
  readonly rank: number;
  /** Opaque, HMAC-keyed identifier for this user. Stable within a
   * single render; cannot be reversed into the raw user_id. */
  readonly user_handle: string;
  /** Public-share token for the user's bracket. Deep-links to the
   * public-profile page. May be null on legacy rows. */
  readonly share_guid: string | null;
  readonly score_total: number;
  readonly bracket_id: string;
  /** Count of fixtures kicked off after this user registered AND on
   * or before now. The leaderboard renders `X / Y` as
   * `score_total / matches_available_to_user`. */
  readonly matches_available_to_user: number;
}

export interface GlobalLeaderboardResponse {
  readonly tournament_id: string;
  readonly rows: readonly LeaderboardRow[];
}

export interface SyndicateLeaderboardResponse {
  readonly tournament_id: string;
  readonly syndicate_id: string;
  readonly rows: readonly LeaderboardRow[];
}

function base(): string {
  return GAME_API_BASE.replace(/\/+$/, "");
}

export async function fetchGlobalLeaderboard(
  tournamentId: string,
  signal?: AbortSignal,
): Promise<GlobalLeaderboardResponse> {
  const url = `${base()}/v1/leaderboard/${encodeURIComponent(tournamentId)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) {
    throw new Error(`leaderboard ${tournamentId} -> ${r.status}`);
  }
  return (await r.json()) as GlobalLeaderboardResponse;
}

export async function fetchSyndicateLeaderboard(
  tournamentId: string,
  syndicateId: string,
  signal?: AbortSignal,
): Promise<SyndicateLeaderboardResponse> {
  const url =
    `${base()}/v1/leaderboard/${encodeURIComponent(tournamentId)}` +
    `/syndicate/${encodeURIComponent(syndicateId)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) {
    throw new Error(`syndicate-leaderboard ${syndicateId} -> ${r.status}`);
  }
  return (await r.json()) as SyndicateLeaderboardResponse;
}
