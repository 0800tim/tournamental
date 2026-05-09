/**
 * Cascade calculator.
 *
 * Given a tournament definition + a partial bracket prediction (+ optional
 * actual results from the real tournament), resolve every knockout slot
 * to a concrete team where possible. The same calculator is used:
 *
 *   - Live in the browser as the user clicks group standings; every
 *     downstream knockout matchup updates instantly with zero API calls.
 *   - On the server when settling a bracket — actual results override the
 *     user's predictions, so an unsettled bracket still has a meaningful
 *     downstream tree without the user needing to re-pick.
 *
 * Determinism: same (tournament, prediction, completedResults) → same
 * `CascadedBracket`. No randomness, no clock reads.
 */

import type {
  BracketPrediction,
  CompletedResults,
  GroupActualStanding,
  GroupId,
  KnockoutFixture,
  SlotSource,
  TeamId,
  Tournament,
} from "./tournament.js";

// ---------- output types ----------

/**
 * The resolved occupant of a slot. `team` is null when the upstream picks
 * (or actual results) don't yet pin down a concrete team — e.g. the user
 * hasn't yet picked enough of group A's standings.
 */
export interface ResolvedSlot {
  readonly source: SlotSource;
  readonly team: TeamId | null;
  /** True if the team came from a settled actual result, not the user's pick. */
  readonly from_actual: boolean;
}

export interface CascadedKnockout {
  readonly id: string;
  readonly stage: KnockoutFixture["stage"];
  readonly match_no: number;
  readonly home: ResolvedSlot;
  readonly away: ResolvedSlot;
  readonly predicted_winner: TeamId | null;
  readonly actual_winner: TeamId | null;
  /** Convenience: actual_winner ?? predicted_winner ?? null. */
  readonly effective_winner: TeamId | null;
  /** True if any team in this match is on the withdrawn list. */
  readonly affected_by_withdrawal: boolean;
}

export interface CascadedGroup {
  readonly group_id: GroupId;
  readonly predicted_order: readonly TeamId[];
  readonly actual_order: readonly TeamId[] | null;
  /** Effective finishing order (actual if settled, else predicted). May be partial. */
  readonly effective_order: readonly TeamId[];
  readonly settled: boolean;
}

export interface CascadeWarning {
  readonly code:
    | "missing_group_prediction"
    | "incomplete_group_order"
    | "missing_wildcard_pick"
    | "duplicate_team_in_group"
    | "team_not_in_group"
    | "winner_not_in_match"
    | "withdrawn_team_advancing";
  readonly message: string;
  readonly key?: string;
}

export interface CascadedBracket {
  readonly tournament_id: string;
  readonly groups: readonly CascadedGroup[];
  readonly knockouts: readonly CascadedKnockout[];
  /** Ids of locked-in picks (groups + knockouts), for UI rendering. */
  readonly locked_keys: readonly string[];
  /** All teams the user has committed to (1st/2nd of every group + all knockout winners). */
  readonly committed_teams: readonly TeamId[];
  /** Total number of teams that need to be committed for a complete bracket. */
  readonly committed_total_required: number;
  readonly warnings: readonly CascadeWarning[];
}

// ---------- helpers ----------

function findGroupActual(
  results: CompletedResults | undefined,
  group_id: GroupId,
): GroupActualStanding | null {
  if (!results) return null;
  return results.groups.find((g) => g.group_id === group_id) ?? null;
}

function findKnockoutActual(
  results: CompletedResults | undefined,
  match_id: string,
): TeamId | null {
  if (!results) return null;
  const k = results.knockouts.find((m) => m.match_id === match_id);
  return k && k.settled ? k.winner : null;
}

function isWithdrawn(results: CompletedResults | undefined, team: TeamId | null): boolean {
  if (!results || !results.withdrawn || team === null) return false;
  return results.withdrawn.includes(team);
}

/** Sort group ids by their natural ordering (A, B, C, ...). */
function sortedGroupIds(t: Tournament): readonly GroupId[] {
  return [...t.groups.map((g) => g.id)].sort();
}

// ---------- cascade ----------

/**
 * Resolve the full predicted matchup tree.
 *
 * `predictions` is allowed to be partial — missing group predictions just
 * leave the affected downstream slots as `team: null`. `completedResults`,
 * when supplied, takes precedence over the user's picks anywhere it's
 * settled (this is the live-recalc-on-real-results path).
 */
export function cascade(
  tournament: Tournament,
  predictions: BracketPrediction,
  completedResults?: CompletedResults,
): CascadedBracket {
  const warnings: CascadeWarning[] = [];

  // -- 1. Resolve groups --------------------------------------------------
  const cascadedGroups: CascadedGroup[] = [];
  const groupEffective = new Map<GroupId, readonly TeamId[]>();

  for (const group of tournament.groups) {
    const pred = predictions.groups.find((p) => p.group_id === group.id);
    const predicted_order = pred?.order ?? [];
    const actual = findGroupActual(completedResults, group.id);
    const actual_order = actual?.settled ? actual.final_order : null;

    if (!pred) {
      warnings.push({
        code: "missing_group_prediction",
        message: `No prediction for group ${group.id}.`,
        key: `group:${group.id}`,
      });
    } else {
      // sanity: every team in `order` must be in the group
      for (const t of pred.order) {
        if (!group.team_ids.includes(t)) {
          warnings.push({
            code: "team_not_in_group",
            message: `Team ${t} is not in group ${group.id}.`,
            key: `group:${group.id}`,
          });
        }
      }
      // duplicates
      const seen = new Set<TeamId>();
      for (const t of pred.order) {
        if (seen.has(t)) {
          warnings.push({
            code: "duplicate_team_in_group",
            message: `Team ${t} appears more than once in group ${group.id}.`,
            key: `group:${group.id}`,
          });
        }
        seen.add(t);
      }
      if (pred.order.length < tournament.advancement.automatic_per_group) {
        warnings.push({
          code: "incomplete_group_order",
          message: `Group ${group.id}: at least ${tournament.advancement.automatic_per_group} positions required to feed the knockouts.`,
          key: `group:${group.id}`,
        });
      }
    }

    // effective_order: prefer actual, fall back to predicted
    const effective_order = actual_order ?? predicted_order;
    groupEffective.set(group.id, effective_order);
    cascadedGroups.push({
      group_id: group.id,
      predicted_order,
      actual_order,
      effective_order,
      settled: actual?.settled ?? false,
    });
  }

  // -- 2. Build wildcard pools (best-thirds, best-fourths) ----------------
  // Effective wildcard ordering: actual results override user picks where settled.
  // Where a wildcard slot's source group isn't fully settled, fall back to the
  // user's pre-tournament wildcard ordering.

  function wildcardLookup(
    rank: number,
    eligible_groups: readonly GroupId[],
    position: 3 | 4,
  ): TeamId | null {
    // 1. If the user supplied an explicit wildcard ordering, use it.
    const userPicks = position === 3 ? predictions.best_thirds : predictions.best_fourths;
    if (rank - 1 < userPicks.length && userPicks[rank - 1]) {
      const picked = userPicks[rank - 1] as TeamId;
      // Validate the pick is a 3rd/4th placer in some eligible group's
      // effective order (predicted or actual). If not, still return it
      // — the cascade is best-effort; the score model will flag it.
      const _ = position; // keep linter happy
      return picked;
    }
    // 2. Else attempt to derive from effective group orders. We can only
    // do this if every eligible group has settled (or has at least
    // `position` predictions in its order). This deliberately does NOT
    // synthesise a wildcard ranking from FIFA rank — that's a product
    // decision left to the API agent. We just return null.
    for (const g of eligible_groups) {
      const order = groupEffective.get(g) ?? [];
      if (order.length < position) {
        warnings.push({
          code: "missing_wildcard_pick",
          message: `Wildcard pool needs the ${position}-th placed team in group ${g} (or an explicit best_${
            position === 3 ? "thirds" : "fourths"
          } pick).`,
          key: `wildcard:${position}:${rank}`,
        });
        return null;
      }
    }
    return null; // no explicit pick and we don't auto-rank
  }

  // -- 3. Resolve knockout slots ------------------------------------------
  // Walk knockouts in order so by the time we resolve a knockout_winner
  // slot, its upstream match is already resolved.

  const cascadedByMatch = new Map<string, CascadedKnockout>();
  const orderedKnockouts = [...tournament.knockouts].sort((a, b) => a.match_no - b.match_no);

  function resolveSlot(source: SlotSource): ResolvedSlot {
    switch (source.kind) {
      case "group_position": {
        const group = tournament.groups.find((g) => g.id === source.group);
        const effective = groupEffective.get(source.group) ?? [];
        const actual = findGroupActual(completedResults, source.group);
        const idx = source.position - 1;
        if (!group) return { source, team: null, from_actual: false };
        const team = idx < effective.length ? effective[idx] : null;
        const from_actual =
          team !== null && actual?.settled === true && idx < (actual.final_order.length ?? 0);
        return { source, team: team ?? null, from_actual };
      }
      case "best_third": {
        const team = wildcardLookup(source.rank, source.eligible_groups, 3);
        return { source, team, from_actual: false };
      }
      case "best_fourth": {
        const team = wildcardLookup(source.rank, source.eligible_groups, 4);
        return { source, team, from_actual: false };
      }
      case "knockout_winner": {
        const upstream = cascadedByMatch.get(source.match_id);
        const actualWinner = findKnockoutActual(completedResults, source.match_id);
        if (actualWinner) return { source, team: actualWinner, from_actual: true };
        return {
          source,
          team: upstream?.predicted_winner ?? null,
          from_actual: false,
        };
      }
      case "knockout_loser": {
        // not used in vanilla single-elim, but supported for 3rd-place playoff
        const upstream = cascadedByMatch.get(source.match_id);
        if (!upstream) return { source, team: null, from_actual: false };
        const winner = upstream.effective_winner;
        if (!winner) return { source, team: null, from_actual: false };
        // The loser is whichever side isn't the winner.
        const loser =
          upstream.home.team && upstream.home.team !== winner
            ? upstream.home.team
            : upstream.away.team && upstream.away.team !== winner
              ? upstream.away.team
              : null;
        return { source, team: loser, from_actual: !!findKnockoutActual(completedResults, upstream.id) };
      }
    }
  }

  for (const k of orderedKnockouts) {
    const home = resolveSlot(k.home);
    const away = resolveSlot(k.away);

    const predForMatch = predictions.knockouts.find((p) => p.match_id === k.id);
    const validWinners = [home.team, away.team].filter((t): t is TeamId => !!t);
    let predicted_winner: TeamId | null = null;
    if (predForMatch) {
      if (validWinners.length === 2 && !validWinners.includes(predForMatch.winner)) {
        warnings.push({
          code: "winner_not_in_match",
          message: `Predicted winner ${predForMatch.winner} for ${k.id} is not one of the resolved combatants (${validWinners.join(", ")}).`,
          key: `knockout:${k.id}`,
        });
      } else {
        predicted_winner = predForMatch.winner;
      }
    }

    const actual_winner = findKnockoutActual(completedResults, k.id);
    const effective_winner = actual_winner ?? predicted_winner;

    const affected_by_withdrawal =
      isWithdrawn(completedResults, home.team) || isWithdrawn(completedResults, away.team);
    if (affected_by_withdrawal) {
      warnings.push({
        code: "withdrawn_team_advancing",
        message: `Match ${k.id} involves a withdrawn team.`,
        key: `knockout:${k.id}`,
      });
    }

    const cascaded: CascadedKnockout = {
      id: k.id,
      stage: k.stage,
      match_no: k.match_no,
      home,
      away,
      predicted_winner,
      actual_winner,
      effective_winner,
      affected_by_withdrawal,
    };
    cascadedByMatch.set(k.id, cascaded);
  }

  const knockouts = orderedKnockouts.map((k) => cascadedByMatch.get(k.id)!);
  const locked_keys = predictions.locks.map((l) => l.key);

  // -- 4. Committed-team tally -------------------------------------------
  const committed = new Set<TeamId>();
  for (const g of cascadedGroups) {
    const advance = tournament.advancement.automatic_per_group;
    for (let i = 0; i < advance && i < g.predicted_order.length; i++) {
      committed.add(g.predicted_order[i] as TeamId);
    }
  }
  for (const t of predictions.best_thirds) committed.add(t);
  for (const t of predictions.best_fourths) committed.add(t);
  for (const k of knockouts) {
    if (k.predicted_winner) committed.add(k.predicted_winner);
  }

  const committed_total_required =
    tournament.advancement.automatic_per_group * tournament.groups.length +
    tournament.advancement.wildcard_third +
    tournament.advancement.wildcard_fourth +
    tournament.knockouts.length; // each knockout commits a winner

  // Use sortedGroupIds purely as a determinism affordance for downstream
  // consumers that iterate `cascadedGroups` — re-sort by group id.
  const sortedGroups = sortedGroupIds(tournament);
  const groupsSorted = [...cascadedGroups].sort(
    (a, b) => sortedGroups.indexOf(a.group_id) - sortedGroups.indexOf(b.group_id),
  );

  return {
    tournament_id: tournament.id,
    groups: groupsSorted,
    knockouts,
    locked_keys,
    committed_teams: [...committed].sort(),
    committed_total_required,
    warnings,
  };
}
