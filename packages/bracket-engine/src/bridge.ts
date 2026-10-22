/**
 * Cascade bridge: convert the per-match `Bracket` (outcome predictions
 * per fixture, tiebreakers, the user's best-thirds picks) into the
 * `BracketPrediction` shape the cascade consumes (a predicted finishing
 * order per group plus knockout winner picks).
 *
 * The per-match `Bracket` is the user-facing draft model; the cascade
 * works in terms of "predicted finishing order per group" because it
 * has a large test contract around that. One helper here serves both
 * the browser (bracket builder, molecule, share previews) and the game
 * service (share-page summariser), which used to carry a copy each.
 *
 * Rules the two callers converged on:
 *   - A group's order is emitted only when every fixture in it is
 *     predicted. Anything less leans on the alphabetical or tiebreaker
 *     fallback for teams that have not played enough matches and leaks
 *     misleading knockout matchups (brand-new sessions used to show
 *     teams in the round of 32 with zero group picks, 2026-05-23).
 *   - Best thirds are the user's explicit picks, never derived from the
 *     standings: outcome-only predictions cannot rank thirds beyond
 *     points, and recomputing them server-side once seeded the round of
 *     32 differently from the builder (2026-06-11).
 *   - Knockout picks are left empty; callers overlay them from the
 *     cascade's resolved slots, pass by pass.
 *
 * Pure apart from the `updated_at_utc` fallback, which reads the clock
 * only when the bracket has no `lockedAt`; pass `nowIso` to pin it.
 */

import { computeGroupStandings, isGroupComplete } from "./standings.js";
import type { Bracket, BracketPrediction, Tournament } from "./tournament.js";

export function bracketToCascadeInput(
  tournament: Tournament,
  bracket: Bracket,
  user_id: string,
  nowIso?: string,
): BracketPrediction {
  const groups = tournament.groups.map((g) => {
    const complete = isGroupComplete(g.id, tournament, bracket.matchPredictions);
    const tiebreaker = bracket.groupTiebreakers[g.id];
    const standings = computeGroupStandings(g.id, tournament, bracket.matchPredictions, tiebreaker);
    return {
      group_id: g.id,
      order: complete ? standings.map((s) => s.teamCode) : [],
    };
  });

  return {
    tournament_id: tournament.id,
    user_id,
    groups,
    best_thirds: bracket.bestThirds ?? [],
    best_fourths: [],
    knockouts: [],
    locks: [],
    updated_at_utc: bracket.lockedAt ?? nowIso ?? new Date().toISOString(),
  };
}
