/**
 * Shared types for the calendar picker surface.
 *
 * Tim 2026-06-12: split out so the context, provider, and per-row
 * helpers can all import without a circular dependency.
 */

export interface ResultedMatch {
  readonly matchId: string;
  readonly outcome: "home_win" | "draw" | "away_win";
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}
