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
    | "hashing"
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
  /** Live merkle-hashing progress aggregated across workers. Null when
   *  no worker is currently hashing. */
  readonly hashing: HashingSnapshot | null;
}

/**
 * Aggregated merkle-hashing progress across all workers. The UI uses
 * this to render lines like:
 *   "Sealing Merkle: slice 7 of 8, level 4 of 17, 1,024 hashes left"
 */
export interface HashingSnapshot {
  /** Number of workers that have finished hashing all their slices. */
  readonly slices_done: number;
  /** Total slice count (one per worker). */
  readonly slices_total: number;
  /** Highest level reached by any active worker (loose: best signal of
   *  "we are this deep into the tree"). */
  readonly level: number;
  /** Total levels in the tree currently being walked. */
  readonly total_levels: number;
  /** Sum of leaves_remaining across all active workers. */
  readonly leaves_remaining: number;
  /** Sum of level_size across all active workers when each level
   *  started. Used for "X of Y" framing. */
  readonly level_size: number;
}

export interface SwarmStats {
  readonly best_bot_score: number;
  readonly bots_still_perfect: number;
  readonly merkle_root: string | null;
  readonly federation_rank: number | null;
}

/**
 * Worker -> main thread message shapes.
 *
 * Exported so the main thread (BrowserSwarm.tsx) and any federation
 * consumers (federation.ts) can import a single source of truth instead
 * of redefining them.
 */
export interface WorkerProgressMessage {
  readonly kind: "progress";
  readonly worker_index: number;
  readonly bots_generated: number;
  readonly picks_made: number;
  readonly current_match_id: string | null;
}

export interface WorkerHashingMessage {
  readonly kind: "hashing";
  readonly worker_index: number;
  /** Which slice (= which match) inside this worker's queue. 0-indexed. */
  readonly slice_index: number;
  /** Total slices this worker will hash (= matches.length). */
  readonly slice_total: number;
  /** Which level of the merkle tree the worker just finished a batch on. */
  readonly level: number;
  /** Total levels in the tree for this match's slice. */
  readonly total_levels: number;
  /** Items remaining at THIS level when the message was sent. */
  readonly leaves_remaining: number;
  /** Items in the level when it started. */
  readonly level_size: number;
}

export interface WorkerSliceDoneMessage {
  readonly kind: "slice_done";
  readonly worker_index: number;
  readonly run_id: string;
  readonly merkle_roots_by_match: Record<string, string>;
  readonly best_bot_score: number;
  readonly bots_generated: number;
  readonly picks_made: number;
  readonly elapsed_ms: number;
  readonly sample_bots: BotRecord[];
  readonly sample_picks: BotPick[];
}

export interface WorkerErrorMessage {
  readonly kind: "error";
  readonly worker_index: number;
  readonly message: string;
}

export type WorkerOutboundMessage =
  | WorkerProgressMessage
  | WorkerHashingMessage
  | WorkerSliceDoneMessage
  | WorkerErrorMessage;

/**
 * Final swarm completion payload, posted to the federation layer (A3).
 *
 * A3 owns `federation.ts` and decides what `top_N_claim` looks like at
 * the wire; we leave the slot so federation can fill it from the sample
 * bots once a scoring rule lands.
 */
export interface SwarmCompletionPayload {
  readonly master_seed: string;
  readonly run_id: string;
  readonly total_bots: number;
  readonly merkle_root: string;
  readonly strategy: StrategyName;
  readonly started_at: number;
  readonly finished_at: number;
  /** Per-match merkle roots, combined across workers. The single
   *  `merkle_root` above is the merkle root over THESE roots (sorted-
   *  pair sha256), so the federation server can verify the rollup. */
  readonly per_match_roots: Record<string, string>;
  /** Best chalk-score observed across the swarm. */
  readonly best_bot_score: number;
  /** Optional bracket-of-N submission the federation layer can use to
   *  stake a leaderboard claim. A3 fills the schema; we keep the slot. */
  readonly top_N_claim?: ReadonlyArray<{
    readonly bot_index: number;
    readonly top3_picks: readonly Outcome[];
    readonly claimed_score?: number;
  }>;
}
