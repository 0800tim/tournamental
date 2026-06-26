/**
 * Build a `CompletedResults` from recorded real match results so the
 * cascade can resolve knockout slots to the REAL qualifiers instead of
 * the player's forecast.
 *
 * Phase 1 (Tim 2026-06-26): group standings only. We turn the recorded
 * group-stage results into the same `MatchPrediction` shape the engine
 * already uses for forecast standings, run the engine's standings
 * computation per group, and emit a `final_order` for each group that
 * has been *fully* played (`settled: true`). The cascade then fills any
 * `group_position` knockout slot (eg R32 Match 73 = 2A v 2B) with the
 * real team the instant both feeder groups settle, and falls back to the
 * player's forecast for groups still in progress.
 *
 * Best third-placed teams (the `annex_c_third` slots) are NOT resolved
 * here: they need every group settled plus the Annex C allocation table,
 * which is Phase 2. Until then those slots stay TBC.
 *
 * Pure function, no IO. Same inputs -> same output.
 */

import {
  computeGroupStandings,
  type CompletedResults,
  type MatchPrediction,
  type ResolvedSlot,
  type Tournament,
} from "@tournamental/bracket-engine";

/**
 * The team to DISPLAY for a resolved knockout slot, under the hybrid
 * actual-then-forecast model (Tim 2026-06-26):
 *
 *   - R32 SEED slots (group_position / best_third / annex_c_third) show the
 *     REAL team only, once their group is settled; otherwise TBD. We never
 *     show a group-stage forecast here.
 *   - FORWARD slots (knockout_winner / knockout_loser, ie R16 through the
 *     final + third-place play-off) show whatever the cascade resolved: the
 *     ACTUAL winner once the upstream match results, otherwise the player's
 *     FORECAST winner cascaded down from their R32+ picks.
 *
 * Returns null for TBD.
 */
export function displayKnockoutTeam(slot: ResolvedSlot): string | null {
  if (!slot.team) return null;
  if (slot.from_actual) return slot.team;
  const k = slot.source.kind;
  return k === "knockout_winner" || k === "knockout_loser" ? slot.team : null;
}

/** Minimal recorded-result shape this helper needs. The map is keyed by
 *  the bare match-number string ("1".."104"); the value needs the outcome
 *  and (for knockout matches) the winning team code, exposed as either
 *  `winner` (calendar) or `winnerCode` (bracket) — both are read. Scores
 *  are optional. The calendar's and bracket's own `ResultedMatch` types
 *  satisfy this structurally. */
export interface RecordedResultLite {
  readonly outcome: "home_win" | "draw" | "away_win";
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  /** 3-letter code of the winner; for knockouts, the team that advances.
   *  Read from whichever field the caller exposes: `winner` / `winnerCode`
   *  (typed) or the raw API's `winner_code` (snake_case). */
  readonly winner?: string | null;
  readonly winnerCode?: string | null;
  readonly winner_code?: string | null;
}

/**
 * Derive `CompletedResults` (group standings) from recorded results.
 * A group is `settled` only when every one of its group-stage fixtures
 * has a recorded result; partially-played groups are emitted with
 * `settled: false` so the cascade leaves their slots unresolved (TBD).
 */
export function buildCompletedResults(
  tournament: Tournament,
  results: ReadonlyMap<string, RecordedResultLite>,
): CompletedResults {
  const byMatch = results;

  const groups = tournament.groups.map((g) => {
    const groupFixtures = tournament.group_fixtures.filter(
      (f) => f.group_id === g.id,
    );

    const preds: Record<string, MatchPrediction> = {};
    let recorded = 0;
    for (const f of groupFixtures) {
      const key = String(f.match_no);
      const r = byMatch.get(key);
      if (!r) continue;
      recorded += 1;
      preds[key] = {
        matchId: key,
        outcome: r.outcome,
        ...(typeof r.homeScore === "number" ? { homeScore: r.homeScore } : {}),
        ...(typeof r.awayScore === "number" ? { awayScore: r.awayScore } : {}),
        lockedAt: "",
      };
    }

    const settled = groupFixtures.length > 0 && recorded === groupFixtures.length;
    const standings = computeGroupStandings(g.id, tournament, preds);
    return {
      group_id: g.id,
      final_order: standings.map((s) => s.teamCode),
      settled,
    };
  });

  // Knockout results: once a knockout match (R32 onward) has a recorded
  // winner, feed it in as a settled actual so the cascade resolves the next
  // round's slot to the REAL team that advanced, overriding the player's
  // forecast. Keyed by the knockout fixture id (eg "r32_01"). Knockouts have
  // no draws, so a settled result always carries a winner code. Tim
  // 2026-06-26 (forecast-forward + actual-override).
  const knockouts: Array<{
    match_id: string;
    winner: string;
    settled: boolean;
  }> = [];
  for (const ko of tournament.knockouts) {
    // Knockout RESULTS are keyed by the knockout id (eg "r32_01"), the same
    // key knockout PICKS use, so scoring lines up. (Group results are keyed
    // by bare match number.) Tim 2026-06-26.
    const r = byMatch.get(ko.id);
    if (!r) continue;
    const winner = r.winner ?? r.winnerCode ?? r.winner_code ?? null;
    if (!winner) continue;
    knockouts.push({ match_id: ko.id, winner, settled: true });
  }

  return { groups, knockouts };
}
