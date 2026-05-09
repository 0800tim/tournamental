/**
 * Shared types for the live-odds client + components.
 *
 * The wire format here is what `apps/odds-ingest` will return on the
 * REST endpoints described in `docs/29-polymarket-odds-integration.md`.
 * Until the real API ships, the same shape is produced by `mock.ts` and
 * by the local `/api/odds/*` route stubs.
 *
 * Probabilities are normalised floats in [0, 1] and always sum to ~1.0.
 * `homeWin + draw + awayWin = 1.0` for group matches; `homeWin + awayWin
 * = 1.0` for knockout matches (the engine encodes a missing draw as a
 * `null`).
 */
export type OddsSource =
  | "polymarket"
  | "kalshi"
  | "mock-fifa-rank"
  | "mock-stub";

/**
 * W/D/L probabilities for a single match. `draw` is `null` for knockout
 * matches; `homeWin + awayWin = 1.0` in that case.
 */
export interface MatchOdds {
  /** Match identity. Group fixtures use `String(match_no)`; knockouts
   * use the engine `id` (e.g. "r32_03", "final"). */
  readonly matchNo: string;
  /** Home team code (3-letter, e.g. "ARG"). May be empty for knockouts
   * whose slot isn't yet known. */
  readonly homeTeam: string;
  /** Away team code. */
  readonly awayTeam: string;
  /** Probability the home team wins, [0, 1]. */
  readonly homeWin: number;
  /** Probability of a draw, [0, 1]. `null` for knockouts. */
  readonly draw: number | null;
  /** Probability the away team wins, [0, 1]. */
  readonly awayWin: number;
  /** Where the data came from, for the hover-card attribution + the
   * affiliate-CTA gating. */
  readonly source: OddsSource;
  /** ISO timestamp the upstream snapshot was taken. */
  readonly updatedAt: string;
  /** Optional Polymarket market id, used by the affiliate CTA. */
  readonly marketId?: string;
  /** Optional Polymarket outcome token for the home team (used by the
   * "Back Home on Polymarket" deep link). */
  readonly homeOutcomeToken?: string;
  /** Optional Polymarket outcome token for the away team. */
  readonly awayOutcomeToken?: string;
}

/** A single point in a 14-day sparkline of probability movement. */
export interface OddsHistoryPoint {
  readonly ts: string;
  readonly homeWin: number;
  readonly draw: number | null;
  readonly awayWin: number;
}

export interface OddsHistory {
  readonly matchNo: string;
  readonly bucket: "5m" | "1h" | "1d";
  readonly points: readonly OddsHistoryPoint[];
}

/** Summary across all markets where a team is an outcome. Currently we
 * surface just the group-winner probability. */
export interface TeamWinnerSummary {
  readonly teamCode: string;
  readonly tournamentWinnerProb: number | null;
  readonly groupWinnerProb: number | null;
  readonly source: OddsSource;
  readonly updatedAt: string;
}

/** Summary for a single team's group-winner market. */
export interface TeamGroupSummary {
  readonly teamCode: string;
  readonly groupId: string;
  readonly groupWinnerProb: number;
  readonly source: OddsSource;
  readonly updatedAt: string;
}

/** Discriminated result for client calls so the UI can branch on
 * tier-fallback without throwing. */
export type OddsClientResult<T> =
  | { readonly ok: true; readonly data: T; readonly tier: "live" | "stub" | "mock" }
  | { readonly ok: false; readonly error: string };
