/**
 * Browser-swarm shared types.
 *
 * Mirrors `packages/bot-node/src/types.ts` so a worker-generated bot
 * pick can be federated to the central server using the same payload
 * shape as the docker-image bot node. This keeps the federation
 * protocol single-shape across all node families (central, docker,
 * browser) which the spec §15.6 calls out as a hard Phase 1 constraint.
 */

export type Outcome = "home_win" | "draw" | "away_win";

export interface MatchOdds {
  readonly home_win: number;
  readonly draw: number;
  readonly away_win: number;
}

export interface MatchSpec {
  readonly match_id: string;
  readonly tournament_id: string;
  readonly home_team: string;
  readonly away_team: string;
  readonly kickoff_utc: string;
  readonly allows_draw: boolean;
  readonly odds?: MatchOdds;
}

export interface BotRecord {
  readonly bot_id: string;
  readonly seed: string;
  readonly strategy: string;
  readonly chalk_score: number;
  readonly created_at: number;
}

export interface BotPick {
  readonly bot_id: string;
  readonly match_id: string;
  readonly outcome: Outcome;
  readonly chalk_score: number;
  readonly locked_at_utc: number;
  /** null until the worker has bundled it into a per-match merkle root. */
  committed_at_utc: number | null;
}

export interface CommitLogRow {
  readonly match_id: string;
  readonly merkle_root: string;
  readonly bot_count: number;
  readonly kickoff_at_utc: number;
  readonly committed_at_utc: number;
  central_ack_at_utc: number | null;
}

export interface NodeCredentials {
  readonly node_id: string;
  readonly node_secret: string;
  readonly operator_email: string | null;
  readonly central_base_url: string;
  readonly registered_at_utc: number;
}

export type StrategyName = "chalk-v1" | "claude-3-5-sonnet" | "gpt-4o";

export interface SwarmConfig {
  readonly bot_count: number;
  readonly strategy: StrategyName;
  readonly matches: readonly MatchSpec[];
  /** Optional LLM API key for non-chalk strategies. Never persisted to
   *  central, only used in-browser to call the user's chosen vendor. */
  readonly api_key?: string;
  /** Optional Supabase config; if absent the swarm uses IndexedDB only. */
  readonly supabase?: SupabaseConfig;
}

export interface SupabaseConfig {
  readonly url: string;
  readonly anon_key: string;
}

export interface SwarmProgress {
  readonly phase:
    | "idle"
    | "preparing"
    | "generating"
    | "committing"
    | "federating"
    | "done"
    | "error";
  readonly bots_generated: number;
  readonly picks_made: number;
  readonly current_match_id: string | null;
  readonly merkle_roots_built: number;
  readonly errors: readonly string[];
  /** Bots-per-second observed over the last ~250ms window. */
  readonly throughput: number;
  /** UNIX ms when the run started. */
  readonly started_at: number | null;
}

export interface SwarmStats {
  readonly best_bot_score: number;
  readonly bots_still_perfect: number;
  readonly merkle_root: string | null;
  readonly federation_rank: number | null;
}
