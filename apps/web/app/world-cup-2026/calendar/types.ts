/**
 * Shared types for the calendar picker surface.
 *
 * Tim 2026-06-12: split out so the context, provider, and per-row
 * helpers can all import without a circular dependency.
 */

/**
 * Matches the shape returned by /api/v1/match-results/<tid>: the
 * key is snake_case `match_id` because the SQL row column is named
 * that way and the persistence layer surfaces it verbatim. Scores
 * are camelCase because they're parsed out of a stored JSON blob
 * whose author used camelCase. Don't "tidy" either — the JSON
 * passes through several layers untouched.
 */
export interface ResultedMatch {
  readonly match_id: string;
  readonly outcome: "home_win" | "draw" | "away_win";
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}
