/**
 * Shared in-process types for the game service.
 *
 * Bracket / MatchPrediction shapes are re-exported from
 * `@vtorn/bracket-engine` so the service speaks the same language as the
 * rest of the platform. We never redefine them here — single source of
 * truth.
 */

import type { Bracket } from "@vtorn/bracket-engine";

export type { Bracket };

/**
 * Outcome stored against a knockout/group match. Mirrors the shape the
 * scoring engine expects:
 *   - For group matches: `outcome` ∈ {"home_win","draw","away_win"}, with
 *     optional homeScore/awayScore for the exact-score bonus.
 *   - For knockout matches: `winner` is the canonical result; `outcome`
 *     is set to "home_win"/"away_win" by the server when persisting so the
 *     same record can score both surfaces if the bracket UI ever moves to
 *     per-knockout match-prediction shape.
 */
export interface MatchOutcome {
  readonly outcome: "home_win" | "draw" | "away_win";
  readonly homeScore?: number;
  readonly awayScore?: number;
  /** Canonical winner team id for knockout matches (R32+). */
  readonly winner?: string;
  /** Knockout stage (r32, r16, qf, sf, f). Omitted for group matches. */
  readonly stage?: "group" | "r32" | "r16" | "qf" | "sf" | "f";
  /** Polymarket-implied probability of the actual outcome at lock time. */
  readonly impliedAtLock?: number;
  /**
   * Seconds elapsed from "draw + 24h" to the user's lock time. Used by the
   * lock-multiplier. We default to 0 (max multiplier) when we don't know;
   * production callers should always set this.
   */
  readonly secondsSinceLock?: number;
  /**
   * Total seconds in the lock window (draw → kickoff). Defaults to 30 days
   * when the admin doesn't specify, which produces sensible values for
   * smoke tests.
   */
  readonly windowSeconds?: number;
}

/** Lock receipt returned to the user after a successful submit. */
export interface LockReceipt {
  readonly bracket_id: string;
  readonly user_id: string;
  readonly tournament_id: string;
  readonly locked_at: string;
  readonly version: number;
}

/** Leaderboard row served to clients. */
export interface LeaderboardRow {
  readonly rank: number;
  readonly user_id: string;
  readonly score_total: number;
  readonly bracket_id: string;
}
