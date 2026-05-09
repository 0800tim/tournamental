/**
 * Shared types for the odds-ingest service. Kept deliberately framework-free
 * so the same shapes can be re-used by `apps/api` and `apps/web` clients.
 */

export type OddsSource = "polymarket" | "theoddsapi" | "mock";

export type MarketKind =
  | "match_moneyline"
  | "tournament_winner"
  | "group_winner"
  | "top_scorer";

export interface OutcomeMapping {
  /** Human-readable label as it appears in the source feed (e.g. "Argentina", "Draw"). */
  label: string;
  /** FIFA team code if this outcome maps to a team (e.g. "ARG"). */
  our_team_code: string | null;
  /** Player id if this outcome maps to a player (top-scorer markets). */
  our_player_id: string | null;
  /** Source-specific token id (Polymarket Yes/No token, Odds API outcome name). */
  source_token_id: string | null;
}

export interface OddsMarket {
  id: string;
  source: OddsSource;
  source_id: string | null;
  match_id: string | null;
  kind: MarketKind;
  question: string;
  outcomes: OutcomeMapping[];
  starts_at: number | null;
  ends_at: number | null;
  resolved: boolean;
  resolved_outcome: string | null;
  updated_at: number;
}

export interface OddsTick {
  market_id: string;
  outcome_label: string;
  best_bid: number | null;
  best_ask: number | null;
  last: number | null;
  /** Canonical 0..1 implied probability. Always populated. */
  implied_prob: number;
  volume_24h: number | null;
  ts: number;
}

export type SourceStatus = "live" | "degraded" | "down";

export interface SourceHealth {
  polymarket: SourceStatus;
  theoddsapi: SourceStatus;
  mock: SourceStatus;
}

/** Shape returned by GET /v1/odds/match/:matchNo */
export interface MatchOddsResponse {
  match_no: number;
  kickoff: string | null;
  source: OddsSource;
  ts: number;
  home: { code: string; name: string; prob: number };
  draw: { prob: number } | null;
  away: { code: string; name: string; prob: number };
}
