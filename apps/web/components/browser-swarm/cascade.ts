/**
 * Per-bot knockout cascade resolver.
 *
 * The browser swarm regenerates each bot's pick for matches 1-72 (group
 * stage) and 73-104 (knockout stage) as a per-match Outcome
 * ("home_win" / "draw" / "away_win"). The detail view at
 * `/run/bots/[index]` shows real team names for group matches because
 * those teams are already known, but the knockout rows show slot
 * placeholders ("winner_grpA", "annex_third_vs_grpB", ...) because the
 * knockout slot graph in `@tournamental/bracket-engine` is declarative,
 * not pre-resolved.
 *
 * This module resolves the cascade per bot:
 *
 *   1. From the bot's per-match group-stage picks, compute group
 *      standings via `computeGroupStandings()` (which already handles
 *      points -> GD -> GF -> head-to-head -> alphabetical fallback).
 *   2. Select the bot's 8 "best thirds" deterministically. Without
 *      explicit scores the engine's tiebreaker would alphabetise every
 *      group's 3rd-placer; instead we rank by FIFA-rank (lower = better)
 *      so the bot's group standings cascade to a coherent best-third
 *      pool. The same rank table feeds the chalk strategy elsewhere.
 *   3. Walk knockout fixtures in order, choosing each knockout winner
 *      from the bot's pre-existing per-knockout Outcome (home_win vs
 *      away_win). The cascade calculator resolves which two team codes
 *      that knockout pairs up so we just project the bot's pick onto
 *      the resolved home/away.
 *   4. Run the bracket-engine `cascade()` over the resulting
 *      BracketPrediction to get a CascadedBracket with concrete
 *      home/away team ids for every knockout fixture.
 *
 * The resolver is pure: same (masterSeed, botIndex) maps to the same
 * CascadedBracket every time. ~3ms for a single bot on a mid-range
 * laptop; cheap enough for the per-bot detail view but NOT cheap enough
 * to run over the full list page (the list shows group-match silver /
 * bronze only).
 */

import {
  cascade,
  computeGroupStandings,
  type Bracket,
  type BracketPrediction,
  type CascadedBracket,
  type GroupPrediction,
  type GroupTiebreaker,
  type KnockoutPrediction,
  type MatchPrediction,
  type Team,
  type TeamId,
  type Tournament,
} from "@tournamental/bracket-engine";

import { loadTournament, regenerateBotPick } from "./regenerate";
import { buildDeviationTable, perturbedOutcome } from "./uniqueness";
import type { MatchSpec, Outcome } from "./types";

/**
 * Build a `MatchPrediction` from a single browser-swarm Outcome. We do
 * not synthesise scores; the standings engine treats absent scores as
 * "match counted, contributes 0 GF / 0 GA" which is consistent across
 * every bot.
 */
function predictionFromOutcome(
  matchId: string,
  outcome: Outcome,
): MatchPrediction {
  return {
    matchId,
    outcome,
    lockedAt: "1970-01-01T00:00:00Z",
  };
}

/**
 * Bot-side tiebreaker for groups where the chain
 * points -> GD -> GF -> head-to-head leaves teams tied. Defaults to
 * FIFA-rank order (lower rank = better). Falls back to alphabetical
 * when ranks are missing, matching the engine's own alphabetical
 * fallback. Tim's spec: tie-breaker uses FIFA ranking from teams.json,
 * alphabetical fallback if missing.
 */
function buildGroupTiebreakers(
  tournament: Tournament,
  teamsById: Map<TeamId, Team>,
): Record<string, GroupTiebreaker> {
  const out: Record<string, GroupTiebreaker> = {};
  for (const group of tournament.groups) {
    const ranked = [...group.team_ids].sort((a, b) => {
      const ra = teamsById.get(a)?.fifa_rank;
      const rb = teamsById.get(b)?.fifa_rank;
      if (typeof ra === "number" && typeof rb === "number") {
        if (ra !== rb) return ra - rb;
      } else if (typeof ra === "number") {
        return -1;
      } else if (typeof rb === "number") {
        return 1;
      }
      return a.localeCompare(b);
    });
    // GroupTiebreaker.rankedTeams is typed as a 4-tuple. Pad / slice
    // defensively so the engine's tuple-typed field stays satisfied
    // for any group size the fixtures JSON ships (2026: 4 per group;
    // future formats may differ).
    const slot = (i: number): TeamId => ranked[i] ?? group.team_ids[i] ?? group.team_ids[0]!;
    out[group.id] = {
      groupId: group.id,
      rankedTeams: [slot(0), slot(1), slot(2), slot(3)],
      setAt: "1970-01-01T00:00:00Z",
    };
  }
  return out;
}

/**
 * Build the 8 best-third TeamIds for a bot deterministically. We rank
 * each group's 3rd-placer by FIFA rank (lower rank = better third), then
 * pick the top `wildcard_third` slots. This deliberately does NOT consult
 * the bot's own pick weights for the third-place ranking; the order has
 * to be consistent for the Annex C lookup table to be meaningful, and
 * FIFA rank is the most defensible signal pre-tournament.
 *
 * If fewer than `wildcard_third` groups have a 3rd-placer (e.g. partial
 * standings during a unit-test smoke run), the function pads with
 * alphabetical fallbacks so the prediction is still valid and the
 * cascade still resolves something on every row.
 */
function selectBestThirds(
  tournament: Tournament,
  groupPredictions: readonly GroupPrediction[],
  teamsById: Map<TeamId, Team>,
): TeamId[] {
  const target = tournament.advancement.wildcard_third;
  if (target <= 0) return [];
  const thirds: { team: TeamId; rank: number; group_id: string }[] = [];
  for (const pred of groupPredictions) {
    if (pred.order.length < 3) continue;
    const team = pred.order[2]!;
    const rank = teamsById.get(team)?.fifa_rank ?? 999;
    thirds.push({ team, rank, group_id: pred.group_id });
  }
  thirds.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.team.localeCompare(b.team);
  });
  return thirds.slice(0, target).map((t) => t.team);
}

/**
 * Construct a full `BracketPrediction` for a bot from its per-match
 * Outcomes. The engine's `cascade()` then resolves every knockout slot
 * to a concrete team id (or null if the upstream graph is broken).
 */
export function bracketPredictionForBot(
  masterSeed: string,
  botIndex: number,
  matches: readonly MatchSpec[],
): {
  prediction: BracketPrediction;
  tournament: Tournament;
} {
  const tournament = loadTournament();
  const teamsById = new Map<TeamId, Team>();
  for (const t of tournament.teams) teamsById.set(t.id, t);

  // Per-match predictions, keyed by the canonical match id the
  // bracket-engine uses (group: stringified match_no; knockout: e.g.
  // "r32_01"). The browser-swarm uses the same ids so this is a direct
  // pass-through.
  const groupPredictionsByMatch: Record<string, MatchPrediction> = {};
  const knockoutPredictionsByMatch: Record<string, MatchPrediction> = {};

  const matchById = new Map<string, MatchSpec>();
  for (const m of matches) matchById.set(m.match_id, m);

  // Resolve the bot's pick for every fixture (group + knockout). We
  // use the within-swarm-unique perturbation so the cascade matches
  // exactly what the worker commits. The chalk-blended PRNG sample is
  // still consulted (via `regenerateBotPick`) as a diagnostic
  // fallback, but the perturbation overrides on every match.
  const deviationTable = buildDeviationTable(matches);
  for (let mi = 0; mi < matches.length; mi++) {
    const m = matches[mi]!;
    const fallback = regenerateBotPick(masterSeed, botIndex, m);
    const outcome: Outcome =
      perturbedOutcome(deviationTable, botIndex, mi) ?? fallback.chosen;
    if (m.allows_draw) {
      groupPredictionsByMatch[m.match_id] = predictionFromOutcome(
        m.match_id,
        outcome,
      );
    } else {
      knockoutPredictionsByMatch[m.match_id] = predictionFromOutcome(
        m.match_id,
        outcome,
      );
    }
  }

  // -- 1. Group predictions from standings -------------------------------
  const tiebreakers = buildGroupTiebreakers(tournament, teamsById);
  const groupPredictions: GroupPrediction[] = [];
  for (const group of tournament.groups) {
    const standings = computeGroupStandings(
      group.id,
      tournament,
      groupPredictionsByMatch,
      tiebreakers[group.id],
    );
    groupPredictions.push({
      group_id: group.id,
      order: standings.map((s) => s.teamCode),
    });
  }

  // -- 2. Best thirds ----------------------------------------------------
  const best_thirds = selectBestThirds(tournament, groupPredictions, teamsById);
  // best_fourths is 0 for the 2026 format but populated for forward-
  // compatibility with formats that route 4th-placers through wildcards.
  const best_fourths: TeamId[] = [];

  // -- 3. Knockout predictions -------------------------------------------
  // Resolve home/away per knockout via a first-pass cascade with empty
  // knockout picks, so the bot's Outcome can be projected onto the
  // resolved combatants. The two-pass approach keeps the resolver
  // independent of the order knockouts appear in the matches list.
  const knockoutFirstPass = cascade(tournament, {
    tournament_id: tournament.id,
    user_id: `bot:${botIndex}`,
    groups: groupPredictions,
    best_thirds,
    best_fourths,
    knockouts: [],
    locks: [],
    updated_at_utc: "1970-01-01T00:00:00Z",
  });

  const knockouts: KnockoutPrediction[] = [];
  // The cascade returns knockouts in match_no order; we walk it and
  // resolve each round before the next so r16's home/away (which depend
  // on r32 winners) are known by the time we hit them.
  // The engine's cascade is iterative across rounds inside one call;
  // we add winners progressively by re-cascading per round.
  const allKnockoutFixtures = [...tournament.knockouts].sort(
    (a, b) => a.match_no - b.match_no,
  );
  let cascadeView = knockoutFirstPass;
  for (const fixture of allKnockoutFixtures) {
    const resolved = cascadeView.knockouts.find((k) => k.id === fixture.id);
    if (!resolved) continue;
    const homeTeam = resolved.home.team;
    const awayTeam = resolved.away.team;
    const swarmPick = knockoutPredictionsByMatch[fixture.id];
    if (!swarmPick) continue;
    let winner: TeamId | null = null;
    if (swarmPick.outcome === "home_win") winner = homeTeam;
    else if (swarmPick.outcome === "away_win") winner = awayTeam;
    // For knockouts we never honour "draw"; the chalk strategy already
    // returns home_win / away_win for allows_draw=false matches, but
    // guard defensively so a malformed pick still produces a sensible
    // winner (fall back to whichever combatant resolved first).
    if (winner === null) winner = homeTeam ?? awayTeam;
    if (winner !== null) {
      knockouts.push({ match_id: fixture.id, winner });
      // Re-cascade so the downstream rounds see this winner.
      cascadeView = cascade(tournament, {
        tournament_id: tournament.id,
        user_id: `bot:${botIndex}`,
        groups: groupPredictions,
        best_thirds,
        best_fourths,
        knockouts,
        locks: [],
        updated_at_utc: "1970-01-01T00:00:00Z",
      });
    }
  }

  return {
    prediction: {
      tournament_id: tournament.id,
      user_id: `bot:${botIndex}`,
      groups: groupPredictions,
      best_thirds,
      best_fourths,
      knockouts,
      locks: [],
      updated_at_utc: "1970-01-01T00:00:00Z",
    },
    tournament,
  };
}

/**
 * Full resolved cascade for a bot. Includes the underlying
 * `BracketPrediction` and the engine's `CascadedBracket` so callers can
 * either walk knockouts to render real team names or fall back to the
 * raw prediction for diagnostics.
 */
export interface ResolvedBotBracket {
  readonly prediction: BracketPrediction;
  readonly cascaded: CascadedBracket;
  readonly tournament: Tournament;
}

export function resolveBotBracket(
  masterSeed: string,
  botIndex: number,
  matches: readonly MatchSpec[],
): ResolvedBotBracket {
  const { prediction, tournament } = bracketPredictionForBot(
    masterSeed,
    botIndex,
    matches,
  );
  const cascaded = cascade(tournament, prediction);
  return { prediction, cascaded, tournament };
}

/**
 * Render-time helper: look up the resolved home/away team ids for a
 * given knockout match id. Returns null for unresolved slots (which the
 * UI should fall back to the placeholder labels for, same as today).
 */
export function resolvedKnockoutSlots(
  cascaded: CascadedBracket,
  match_id: string,
): { home: TeamId | null; away: TeamId | null; winner: TeamId | null } | null {
  const k = cascaded.knockouts.find((kn) => kn.id === match_id);
  if (!k) return null;
  return {
    home: k.home.team,
    away: k.away.team,
    winner: k.predicted_winner,
  };
}

/**
 * Pure helper exported for the user-anchored swarm slider so the
 * anchor module can build a Bracket-shaped snapshot of the user's own
 * picks without owning the bracket-engine import path.
 */
export function emptyBracket(tournamentId: string, version = 1): Bracket {
  return {
    bracketId: `anchor-${tournamentId}-${version}`,
    matchPredictions: {},
    knockoutPredictions: {},
    groupTiebreakers: {},
    bestThirds: [],
    version,
  };
}
