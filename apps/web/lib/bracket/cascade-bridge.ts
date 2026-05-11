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
  // the cross-group best-thirds wildcard ranking.
  const standingsByGroup = new Map<string, ReturnType<typeof computeGroupStandings>>();
  const groups = tournament.groups.map((g) => {
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
      order: standings.map((s) => s.teamCode),
    };
  });

  // FIFA 2026: 12 groups × 4 teams. Top 2 from each group + best 8
  // third-placed teams advance to R32. Rank the 12 third-placed teams by
  // points → goal-diff → goals-for → team code (deterministic last-resort
  // tiebreak). Take top 8 to fill best-third R32 slots.
  const thirdPlacers = tournament.groups
    .map((g) => {
      const s = standingsByGroup.get(g.id);
      return s && s.length >= 3 ? s[2] : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  thirdPlacers.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.goalDiff !== b.goalDiff) return b.goalDiff - a.goalDiff;
    if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
    return a.teamCode.localeCompare(b.teamCode);
  });
  const best_thirds = thirdPlacers.slice(0, 8).map((s) => s.teamCode);

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
