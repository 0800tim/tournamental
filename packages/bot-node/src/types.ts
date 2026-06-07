/**
 * Shared types for the Tournamental federated bot node.
 *
 * These mirror the central server's contract surface so a future bump in
 * `@tournamental/spec` can replace this file with re-exports. Keeping them
 * inline for Phase 1 launch so the package has zero workspace coupling and
 * external operators can `npm i @tournamental/bot-node` cleanly.
 */

export type Outcome = "home_win" | "draw" | "away_win";

export interface MatchOdds {
  /** Implied probability of home_win in [0, 1]. */
  home_win: number;
  /** Implied probability of draw in [0, 1]. May be 0 for knockout matches. */
  draw: number;
  /** Implied probability of away_win in [0, 1]. */
  away_win: number;
}

export interface MatchSpec {
  match_id: string;
  tournament_id: string;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  /** Whether draw is a valid outcome (group stage true, knockouts false). */
  allows_draw: boolean;
  odds?: MatchOdds;
}

export interface MatchResult {
  match_id: string;
  outcome: Outcome;
  resolved_at_utc: string;
}

export interface BotRecord {
  bot_id: string;
  /** Deterministic seed so a node can be re-generated bit-for-bit. */
  seed: string;
  strategy: string;
  created_at: number;
}

export interface BotPick {
  bot_id: string;
  match_id: string;
  outcome: Outcome;
  /** Chalk score in [0, 1]: how aggressively the bot follows the favourite. */
  chalk_score: number;
  /** Unix ms when the pick was locked in. */
  locked_at_utc: number;
  /** Unix ms when the pick was bundled into a merkle commitment, null if not yet. */
  committed_at_utc: number | null;
}

export interface CommitLogRow {
  match_id: string;
  merkle_root: string;
  bot_count: number;
  kickoff_at_utc: number;
  committed_at_utc: number;
  central_ack_at_utc: number | null;
}

export interface NodeCredentials {
  node_id: string;
  node_secret: string;
  operator_email: string;
  central_base_url: string;
  registered_at_utc: number;
}

export interface CommitPayload {
  node_id: string;
  match_id: string;
  merkle_root: string;
  bot_count: number;
  kickoff_at: number;
}

export interface LeaderboardEntry {
  bot_id: string;
  correct_picks: number;
  still_perfect: boolean;
}

export interface LeaderboardPayload {
  node_id: string;
  match_id: string;
  total_bots: number;
  bots_correct: number;
  bots_still_perfect: number;
  top_1000: LeaderboardEntry[];
}
