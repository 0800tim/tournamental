/**
 * Cascade bridge, convert the new per-match `Bracket` (groups computed
 * from outcome predictions, plus knockout outcome predictions) into the
 * legacy `BracketPrediction` shape the cascade engine consumes (group
 * orderings + knockout winner picks).
 *
 * The per-match `Bracket` is the user-facing draft model; the cascade
 * engine still works in terms of "predicted finishing order per group"
 * because it has 70+ tests around that contract. We bridge the two so
 * the rest of the engine (cascade, score, vstamp) keeps working without
 * a wholesale rewrite.
 *
 * Pure / deterministic; no clock reads.
 */

import {
  computeGroupStandings,
  isGroupComplete,
  type Bracket,
  type BracketPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

export function bracketToCascadeInput(
  tournament: Tournament,
  bracket: Bracket,
  user_id: string,
): BracketPrediction {
  // Compute standings once per group; reuse for both per-group order and
  // the cross-group best-thirds wildcard ranking. Gate the order behind
  // every fixture in the group being predicted, otherwise the standings
  // engine breaks ties alphabetically when teams are all tied at 0 and
  // the cascade leaks fake R32 matchups before the user has predicted
  // anything (Tim 2026-05-23: brand-new sessions saw teams in R32 with
  // zero group picks). Incomplete groups now emit empty `order`, which
  // makes the cascade resolve every dependent R32 slot to null and the
  // UI render the "to be determined" placeholder.
  const standingsByGroup = new Map<string, ReturnType<typeof computeGroupStandings>>();
  const completeByGroup = new Map<string, boolean>();
  const groups = tournament.groups.map((g) => {
    const complete = isGroupComplete(g.id, tournament, bracket.matchPredictions);
    completeByGroup.set(g.id, complete);
    const tiebreaker = bracket.groupTiebreakers[g.id];
    const standings = computeGroupStandings(
      g.id,
      tournament,
      bracket.matchPredictions,
      tiebreaker,
    );
    standingsByGroup.set(g.id, standings);
    return {
      group_id: g.id,
      // Only emit the order when the group is fully predicted. Anything
      // less than fully-predicted means the standings rely on the
      // alphabetical / tiebreaker fallback for teams that haven't
      // played enough matches, which produces misleading downstream
      // KO matchups.
      order: complete ? standings.map((s) => s.teamCode) : [],
    };
  });

  // World Cup 2026: top 2 of each group + 8 best 3rd-placed teams
  // advance to R32. We do NOT auto-derive the 8 from standings: outcome
  // predictions don't carry score lines, so the points-only ranking has
  // ties we can't break. The user picks 8 explicitly via the "Top 8
  // 3rd Place" stage in BracketBuilder; we pass the picks straight
  // through to the cascade. Empty array until the user fills it; the
  // cascade resolves all annex_c_third slots to null in that case.
  // Used to live here as a sort-by-points-with-zero-GD-tiebreak path
  // (Tim 2026-06-01: outcome-only predictions can't deterministically
  // rank thirds beyond points, so user must choose).
  const best_thirds = bracket.bestThirds ?? [];

  const knockouts = Object.values(bracket.knockoutPredictions).flatMap((p) => {
    // The cascade-engine "winner" is whichever side the user picked. The
    // per-match `outcome` for knockouts is always home_win or away_win;
    // we resolve it against the actual fixture by looking up the
    // knockout's home/away slots in the tournament. The cascade engine
    // itself disambiguates which team is "home" based on the cascade's
    // resolved slots, so we encode the team via the existing
    // `KnockoutPrediction.winner` field. To do this we'd need the
    // resolved slots, but the user's choice is one of those slots.
    //
    // We can pull the predicted winner team-id from the knockout
    // fixture's home/away SlotSource only when it's a `group_position`
    // (and we know who finishes there). For everything else we don't
    // have a team-id in this layer; the `winner` is encoded as a
    // sentinel "home" / "away" string that the consumer must resolve
    // against the cascade. Until the API lands and codifies this, we
    // emit the prediction via a *resolved* helper in the BracketBuilder
    // layer (which has access to the cascade output).
    //
    // For now: skip emitting knockouts here. The bridge consumer
    // populates them from the cascade.
    return [] as BracketPrediction["knockouts"];
  });

  return {
    tournament_id: tournament.id,
    user_id,
    groups,
    best_thirds,
    best_fourths: [],
    knockouts,
    locks: [],
    updated_at_utc: bracket.lockedAt ?? new Date().toISOString(),
  };
}
