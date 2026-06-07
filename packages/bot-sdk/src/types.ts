/**
 * Core types for the Tournamental Bot Arena SDK.
 *
 * Wire format mirrors the bulk-insert API contract at
 * `POST /v1/picks/bulk` (see docs/superpowers/specs/2026-06-07-bot-arena-design.md §7).
 */

/** Match outcome from the home team's perspective. */
export type Outcome = "home_win" | "draw" | "away_win";

/** Tournament stages used by Tournamental brackets. */
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";

/** A single pick: a bot's predicted outcome for one match. */
export interface Pick {
  match_id: string;
  outcome: Outcome;
}

/** Public description of a match. Returned by the matches catalogue endpoint. */
export interface MatchSpec {
  id: string;
  stage: Stage;
  /** ISO country / team code, e.g. "ARG". Optional pre-draw. */
  home_code?: string;
  away_code?: string;
  /** ISO-8601 UTC string. Picks for this match lock at this time. */
  kickoff_utc: string;
}

/** Body of a bulk-insert request. */
export interface BulkSubmission {
  tournament_id: string;
  submissions: { bot_id: string; picks: Pick[] }[];
}

/** Response shape from `POST /v1/picks/bulk`. */
export interface BulkResponse {
  accepted: number;
  dropped_picks: { bot_id: string; match_id: string; reason: string }[];
  quota_remaining: { picks_per_hour: number; bots_owned: number };
}

/**
 * Minimal odds snapshot the SDK passes around when wiring odds-driven
 * strategies. Probabilities should sum to ~1.0 but the SDK does not enforce.
 */
export interface OddsSnapshot {
  match_id: string;
  home_win: number;
  draw: number;
  away_win: number;
  /** Free-form provider tag, e.g. "polymarket" or "synthetic-chalk". */
  source?: string;
}
