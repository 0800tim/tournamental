/**
 * Live-data types for the 2026 FIFA World Cup match-state stream.
 *
 * These shapes are intentionally narrower than the renderer spec
 * (`@vtorn/spec`) — they describe the *minimum* state needed by:
 *   - the renderer to drive a watch-along view (current minute, score,
 *     latest events),
 *   - the push-notifications scheduler (status transitions: scheduled →
 *     live → ht → final, plus goals),
 *   - the bracket-result settlement bridge (final score + winner).
 *
 * The full positional / animation data the renderer ultimately needs comes
 * from the StatsBomb-replay producer (for historic) or video-ingest
 * (during the tournament). This package owns the *meta-state* —
 * scheduling and scoreboard truth — and it is independent of the visual
 * renderer's data plane.
 */

/** Status of a single fixture. */
export type LiveMatchStatus =
  | "scheduled"
  | "live"
  | "ht"
  | "final"
  | "postponed"
  | "abandoned";

/** Type of scoring event in `LiveMatchState.scorers`. */
export type ScorerType = "goal" | "pen" | "og";

/** A single goal/scoring event for the running scorers list. */
export interface LiveScorer {
  /** FIFA team code (3 letters, e.g. "ARG"). */
  readonly teamId: string;
  /** Scorer's display name; sourced from upstream feed. */
  readonly playerName: string;
  /**
   * Match minute at which the goal was registered (1-90 reg, 91-120 ET,
   * 121+ for shootout slots — caller can disambiguate by `type`).
   */
  readonly minute: number;
  readonly type: ScorerType;
}

/**
 * One discrete event in the running event-feed. Distinct from `scorers` —
 * `latestEvents` includes substitutions, cards, kickoff, half/full-time
 * whistles, etc.
 */
export interface LiveEvent {
  readonly minute: number;
  /**
   * Free-form low-cardinality string. Common values:
   *   "kickoff" | "half_time" | "second_half_start" | "full_time"
   *   "goal" | "pen_scored" | "pen_missed" | "own_goal"
   *   "yellow_card" | "red_card" | "substitution"
   *   "var_check" | "stoppage_announced"
   */
  readonly type: string;
  /** Human-readable description, suitable for a ticker or push body. */
  readonly description: string;
}

/**
 * Forward-look fixture row. `currentMinute` is only populated when
 * `status === "live"` or `"ht"`.
 */
export interface LiveFixture {
  /** Stable provider-agnostic match id; we use FIFA match number string. */
  readonly matchId: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly kickoffUtc: string;
  /** Host country code, "US" | "CA" | "MX" — convenience for routing. */
  readonly host: "US" | "CA" | "MX";
  readonly venue: string;
  readonly status: LiveMatchStatus;
  readonly currentMinute?: number;
}

/**
 * Full live state for one match. Subscribers receive a stream of these,
 * one per upstream tick. Consumers should diff against the previous
 * snapshot (e.g. by `version`) to detect changes — every field on this
 * object is the *current* truth, not a delta.
 */
export interface LiveMatchState {
  readonly matchId: string;
  readonly status: LiveMatchStatus;
  /** 0 before kickoff; 45 at HT; 90 / 105 / 120 etc. as time progresses. */
  readonly currentMinute: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly scorers: readonly LiveScorer[];
  readonly latestEvents: readonly LiveEvent[];
  /**
   * Monotonic-per-match version. Consumers can dedup by (matchId, version).
   * Mock provider increments by 1 per tick; real providers should pass
   * upstream sequence numbers or a synthetic counter.
   */
  readonly version: number;
  /** ISO-8601 UTC timestamp of when this snapshot was produced. */
  readonly updatedAtUtc: string;
}

/**
 * Subscriber callback. Fired once per non-duplicate state snapshot. The
 * provider guarantees no duplicates for the same `version` — callers can
 * additionally dedup by `version` if multiple sources merge.
 */
export type LiveMatchUpdate = (state: LiveMatchState) => void;

/**
 * Backend-agnostic interface every provider implements. Implementations
 * MUST be pure with respect to network calls — i.e. no module-scope
 * fetches; all I/O happens inside method calls so tests can mock cleanly.
 */
export interface LiveDataProvider {
  /** Provider name for logs / health output (e.g. "mock", "sportradar"). */
  readonly name: string;

  /** Next-N upcoming or in-progress fixtures, kickoff-ascending. */
  fetchUpcoming(limit: number): Promise<LiveFixture[]>;

  /** One-shot fetch of current state for a given match. */
  fetchMatch(matchId: string): Promise<LiveMatchState>;

  /**
   * Subscribe to a long-poll stream of `LiveMatchState` ticks for one
   * match. Returns an unsubscribe callback that cancels the underlying
   * loop and stops invoking `onUpdate` after the next tick boundary.
   *
   * Implementations should fire an immediate first tick with the current
   * state, then poll on their own cadence (mock: ~250ms; real APIs:
   * 5-15s depending on plan).
   */
  subscribeMatch(matchId: string, onUpdate: LiveMatchUpdate): () => void;
}
