/**
 * Standings computer.
 *
 * Given a set of per-match predictions for a group, compute the predicted
 * standings (P, W, D, L, GF, GA, GD, Pts). Sort teams by:
 *
 *   1. Points (3 / 1 / 0).
 *   2. Goal difference.
 *   3. Goals scored.
 *   4. Head-to-head result among tied teams (mini-table replaying just the
 *      matches between the tied teams; sub-sorted by points → GD → GF).
 *   5. User-supplied tiebreaker pick (when scores aren't enough).
 *
 * The "scores" for sort steps 2 + 3 + 4 only contribute when the user has
 * actually filled in `homeScore`/`awayScore`. If a user left scores blank,
 * goal-diff is zero by definition for that match — same as the FIFA rule
 * book treats "match not yet played". This means a group where all
 * outcomes are picked but no scores are given will tie a lot — and the
 * tiebreaker control becomes the user's lever.
 *
 * Pure / deterministic. No clock reads, no randomness.
 */

import type {
  Group,
  GroupFixture,
  GroupId,
  GroupTiebreaker,
  MatchPrediction,
  TeamId,
  Tournament,
} from "./tournament.js";

// ---------- public types ----------

export interface GroupStanding {
  readonly teamCode: TeamId;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDiff: number;
  readonly points: number;
}

/**
 * A tie that the metric chain (points → GD → GF → head-to-head) couldn't
 * break. The UI surfaces a tiebreaker control for each `TieGroup`. After
 * the user supplies a `GroupTiebreaker`, the standings re-sort using that
 * ranking and the tie disappears.
 */
export interface TieGroup {
  /** Positions (1-indexed) the tied teams occupy in the otherwise-sorted standings. */
  readonly positions: readonly number[];
  readonly teamCodes: readonly TeamId[];
}

// ---------- helpers ----------

interface MutableStanding {
  teamCode: TeamId;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

function freeze(m: MutableStanding): GroupStanding {
  return {
    teamCode: m.teamCode,
    played: m.played,
    wins: m.wins,
    draws: m.draws,
    losses: m.losses,
    goalsFor: m.goalsFor,
    goalsAgainst: m.goalsAgainst,
    goalDiff: m.goalsFor - m.goalsAgainst,
    points: 3 * m.wins + m.draws,
  };
}

function fixtureMatchId(f: GroupFixture): string {
  return String(f.match_no);
}

function teamForIdx(group: Group, idx: number): TeamId {
  return group.team_ids[idx] as TeamId;
}

/**
 * Apply one prediction to the running mutable standings. Outcome and
 * (optional) scores both contribute. If scores are absent, the match
 * counts but contributes 0 GF / 0 GA.
 */
function applyPrediction(
  prediction: MatchPrediction,
  homeCode: TeamId,
  awayCode: TeamId,
  byCode: Map<TeamId, MutableStanding>,
): void {
  const home = byCode.get(homeCode);
  const away = byCode.get(awayCode);
  if (!home || !away) return;
  home.played += 1;
  away.played += 1;

  // Goal counters: only when explicit scores are present.
  const hs = prediction.homeScore;
  const as = prediction.awayScore;
  if (typeof hs === "number" && typeof as === "number") {
    home.goalsFor += hs;
    home.goalsAgainst += as;
    away.goalsFor += as;
    away.goalsAgainst += hs;
  }

  switch (prediction.outcome) {
    case "home_win":
      home.wins += 1;
      away.losses += 1;
      return;
    case "away_win":
      home.losses += 1;
      away.wins += 1;
      return;
    case "draw":
      home.draws += 1;
      away.draws += 1;
      return;
  }
}

// ---------- core ----------

/**
 * Compute the standings for one group, applying each predicted match in
 * order. `fixtures` is the list of all group_fixtures from the tournament;
 * we filter to this group internally so callers can pass the whole list.
 *
 * Sort uses the public metrics (points → GD → GF → head-to-head). Ties
 * that survive head-to-head are returned alongside via
 * `detectTiesNeedingTiebreaker`. If the caller supplies a tiebreaker, ties
 * are resolved using `rankedTeams` as the final tiebreaker.
 */
export function computeGroupStandings(
  groupId: GroupId,
  tournament: Tournament,
  predictions: Record<string, MatchPrediction>,
  tiebreaker?: GroupTiebreaker,
): readonly GroupStanding[] {
  const group = tournament.groups.find((g) => g.id === groupId);
  if (!group) return [];

  const byCode = new Map<TeamId, MutableStanding>();
  for (const t of group.team_ids) {
    byCode.set(t, {
      teamCode: t,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    });
  }

  const groupFixtures = tournament.group_fixtures.filter((f) => f.group_id === groupId);
  for (const f of groupFixtures) {
    const id = fixtureMatchId(f);
    const pred = predictions[id];
    if (!pred) continue;
    const homeCode = teamForIdx(group, f.home_idx);
    const awayCode = teamForIdx(group, f.away_idx);
    applyPrediction(pred, homeCode, awayCode, byCode);
  }

  const standings: GroupStanding[] = group.team_ids.map((t) => freeze(byCode.get(t)!));
  return sortStandings(standings, group, groupFixtures, predictions, tiebreaker);
}

/**
 * Sort by points → GD → GF → head-to-head → tiebreaker pick. Stable for
 * teams that share every metric (the `rankedTeams` slice from a
 * `GroupTiebreaker` settles those).
 */
function sortStandings(
  standings: readonly GroupStanding[],
  group: Group,
  groupFixtures: readonly GroupFixture[],
  predictions: Record<string, MatchPrediction>,
  tiebreaker?: GroupTiebreaker,
): readonly GroupStanding[] {
  // 1. Sort by primary metrics. Within groups of teams that match all of
  // those metrics, run the head-to-head mini-table.
  const primarySorted = [...standings].sort(compareByPrimary);

  // 2. Walk groups of teams that are tied on all primary metrics.
  const out: GroupStanding[] = [];
  let i = 0;
  while (i < primarySorted.length) {
    let j = i + 1;
    while (
      j < primarySorted.length &&
      primarySorted[j] !== undefined &&
      primarySorted[i] !== undefined &&
      tiedOnPrimary(primarySorted[i]!, primarySorted[j]!)
    ) {
      j++;
    }
    if (j - i === 1) {
      out.push(primarySorted[i]!);
    } else {
      const block = primarySorted.slice(i, j);
      const resolved = resolveBlock(block, group, groupFixtures, predictions, tiebreaker);
      out.push(...resolved);
    }
    i = j;
  }

  return out;
}

function compareByPrimary(a: GroupStanding, b: GroupStanding): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  return 0;
}

function tiedOnPrimary(a: GroupStanding, b: GroupStanding): boolean {
  return a.points === b.points && a.goalDiff === b.goalDiff && a.goalsFor === b.goalsFor;
}

/**
 * Resolve a contiguous block of teams that all tie on points/GD/GF using:
 *   1. Head-to-head mini-table (replay only matches between these teams).
 *   2. User-supplied tiebreaker pick.
 *   3. Alphabetical fallback (deterministic; UI flags this with a tie warning).
 */
function resolveBlock(
  block: readonly GroupStanding[],
  group: Group,
  groupFixtures: readonly GroupFixture[],
  predictions: Record<string, MatchPrediction>,
  tiebreaker?: GroupTiebreaker,
): readonly GroupStanding[] {
  if (block.length <= 1) return block;
  const tiedCodes = new Set(block.map((s) => s.teamCode));

  // Step 1: head-to-head mini-table.
  const miniByCode = new Map<TeamId, MutableStanding>();
  for (const s of block) {
    miniByCode.set(s.teamCode, {
      teamCode: s.teamCode,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    });
  }
  for (const f of groupFixtures) {
    const homeCode = teamForIdx(group, f.home_idx);
    const awayCode = teamForIdx(group, f.away_idx);
    if (!tiedCodes.has(homeCode) || !tiedCodes.has(awayCode)) continue;
    const pred = predictions[fixtureMatchId(f)];
    if (!pred) continue;
    applyPrediction(pred, homeCode, awayCode, miniByCode);
  }
  const mini = block.map((s) => freeze(miniByCode.get(s.teamCode)!));
  const headToHeadSorted = [...mini].sort(compareByPrimary);

  // Re-walk: any block that's still tied on the mini-table falls through
  // to the user tiebreaker.
  const out: GroupStanding[] = [];
  let i = 0;
  while (i < headToHeadSorted.length) {
    let j = i + 1;
    while (
      j < headToHeadSorted.length &&
      tiedOnPrimary(headToHeadSorted[i]!, headToHeadSorted[j]!)
    ) {
      j++;
    }
    if (j - i === 1) {
      // single team — push the original (richer-metric) row from `block`
      const teamCode = headToHeadSorted[i]!.teamCode;
      out.push(block.find((s) => s.teamCode === teamCode)!);
    } else {
      const stillTied = headToHeadSorted.slice(i, j).map((s) => s.teamCode);
      const resolvedCodes = resolveByTiebreaker(stillTied, tiebreaker);
      for (const c of resolvedCodes) out.push(block.find((s) => s.teamCode === c)!);
    }
    i = j;
  }

  return out;
}

function resolveByTiebreaker(
  tiedCodes: readonly TeamId[],
  tiebreaker?: GroupTiebreaker,
): readonly TeamId[] {
  if (!tiebreaker) {
    // Deterministic fallback: alphabetical, but the UI surfaces this via
    // detectTiesNeedingTiebreaker. The fallback prevents the sort from
    // throwing or returning null entries.
    return [...tiedCodes].sort();
  }
  const ranked = tiebreaker.rankedTeams;
  const ix = (c: TeamId): number => {
    const i = ranked.indexOf(c);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...tiedCodes].sort((a, b) => ix(a) - ix(b));
}

/**
 * Identify ties that survived points → GD → GF → head-to-head. The UI
 * uses this to surface a tiebreaker control. If `tiebreaker` was applied
 * during sort, those teams won't appear here.
 */
export function detectTiesNeedingTiebreaker(
  standings: readonly GroupStanding[],
  options?: {
    readonly tournament?: Tournament;
    readonly groupId?: GroupId;
    readonly predictions?: Record<string, MatchPrediction>;
    readonly tiebreaker?: GroupTiebreaker;
  },
): readonly TieGroup[] {
  // Walk the sorted output looking for adjacent teams whose primary
  // metrics match AND whose head-to-head metrics also match.
  const out: TieGroup[] = [];
  let i = 0;
  while (i < standings.length) {
    let j = i + 1;
    while (j < standings.length && tiedOnPrimary(standings[i]!, standings[j]!)) {
      j++;
    }
    if (j - i > 1) {
      // Apply head-to-head check via tournament data when supplied.
      const block = standings.slice(i, j);
      let stillTied = block.map((s) => s.teamCode);

      if (options?.tournament && options.groupId && options.predictions) {
        const group = options.tournament.groups.find((g) => g.id === options.groupId);
        if (group) {
          const groupFixtures = options.tournament.group_fixtures.filter(
            (f) => f.group_id === options.groupId,
          );
          const tiedCodes = new Set(stillTied);
          const miniByCode = new Map<TeamId, MutableStanding>();
          for (const c of stillTied) {
            miniByCode.set(c, {
              teamCode: c,
              played: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              goalsFor: 0,
              goalsAgainst: 0,
            });
          }
          for (const f of groupFixtures) {
            const homeCode = teamForIdx(group, f.home_idx);
            const awayCode = teamForIdx(group, f.away_idx);
            if (!tiedCodes.has(homeCode) || !tiedCodes.has(awayCode)) continue;
            const pred = options.predictions[fixtureMatchId(f)];
            if (!pred) continue;
            applyPrediction(pred, homeCode, awayCode, miniByCode);
          }
          const mini = stillTied.map((c) => freeze(miniByCode.get(c)!));
          const sortedMini = [...mini].sort(compareByPrimary);
          // Carve into still-tied sub-blocks.
          const trulyTied: TeamId[][] = [];
          let mi = 0;
          while (mi < sortedMini.length) {
            let mj = mi + 1;
            while (mj < sortedMini.length && tiedOnPrimary(sortedMini[mi]!, sortedMini[mj]!)) {
              mj++;
            }
            if (mj - mi > 1) {
              trulyTied.push(sortedMini.slice(mi, mj).map((s) => s.teamCode));
            }
            mi = mj;
          }
          // Each truly-tied block, minus those resolved by an existing
          // tiebreaker, is a TieGroup.
          for (const tt of trulyTied) {
            if (options.tiebreaker) {
              const ranks = tt.map((c) => options.tiebreaker!.rankedTeams.indexOf(c));
              const allFound = ranks.every((r) => r !== -1);
              const allDistinct = new Set(ranks).size === ranks.length;
              if (allFound && allDistinct) continue; // resolved by tiebreaker
            }
            // Find the positions (1-indexed) within `standings` of these teams.
            const positions: number[] = [];
            for (const c of tt) {
              const pos = standings.findIndex((s) => s.teamCode === c);
              if (pos !== -1) positions.push(pos + 1);
            }
            out.push({ positions: positions.sort((a, b) => a - b), teamCodes: tt });
          }
          i = j;
          continue;
        }
      }

      // No tournament context: every primary-metric tie is reported.
      const positions: number[] = [];
      for (let k = i; k < j; k++) positions.push(k + 1);
      out.push({ positions, teamCodes: stillTied });
    }
    i = j;
  }
  return out;
}

/**
 * Convenience: are all 6 group-stage matches in this group predicted?
 * Used by the UI to decide whether the standings panel is "complete" or a
 * partial/preview state.
 */
export function isGroupComplete(
  groupId: GroupId,
  tournament: Tournament,
  predictions: Record<string, MatchPrediction>,
): boolean {
  const groupFixtures = tournament.group_fixtures.filter((f) => f.group_id === groupId);
  return groupFixtures.every((f) => predictions[fixtureMatchId(f)] !== undefined);
}
