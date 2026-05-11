/**
 * Group-stage summary, pure derivation of a team's group-stage story
 * from the user's per-match predictions. Used by `MoleculePanel` to
 * render the GROUP STAGE section above the knockout rows.
 *
 * The cascade engine already exposes per-group finishing-order via
 * `CascadedGroup.effective_order` and the standings module exposes
 * per-team points / goal-diff / etc. via `computeGroupStandings`. This
 * module is glue: given the user's per-match `Bracket`, a tournament,
 * and a team code, return everything the side panel needs in one
 * deterministic shape.
 *
 * Pure / deterministic; no clock reads.
 */

import {
  computeGroupStandings,
  type Bracket,
  type GroupId,
  type MatchPrediction,
  type Tournament,
  type GroupStanding,
} from "@vtorn/bracket-engine";

// ---------- public types ----------

export interface GroupMatchRow {
  /** Stable match id from `tournament.group_fixtures.match_no`. */
  readonly matchId: string;
  /** Opponent team code (3-letter FIFA code). */
  readonly opponentCode: string;
  /** Opponent display name. */
  readonly opponentName: string;
  /** From the user's prediction: was this match a W / D / L for `teamCode`? */
  readonly result: "W" | "D" | "L" | "TBD";
  /** Points the team got from this match (3 / 1 / 0, or 0 if TBD). */
  readonly points: number;
  /** User's predicted scoreline for this team (null if no scores set). */
  readonly teamScore: number | null;
  /** User's predicted scoreline for the opponent (null if no scores set). */
  readonly opponentScore: number | null;
}

export interface GroupStageSummary {
  /** The team this summary is for. */
  readonly teamCode: string;
  /** Group id (e.g. "A"). null if the team isn't in any group (shouldn't happen). */
  readonly groupId: GroupId | null;
  /**
   * The team's finishing position in their group per the user's
   * predictions (1 = topped, 2 = runner-up, 3 = third, 4 = fourth).
   * null if the user hasn't predicted enough of this group to determine
   * a position (e.g. zero matches predicted).
   */
  readonly position: 1 | 2 | 3 | 4 | null;
  /** Per-match rows, in fixture order. Always 3 entries for a 4-team group. */
  readonly matches: readonly GroupMatchRow[];
  /** Total points across the 3 group matches. */
  readonly totalPoints: number;
  /** Total goal diff across the 3 group matches. */
  readonly goalDiff: number;
  /** True if the user has predicted at least one match in this group. */
  readonly hasAnyPick: boolean;
}

// ---------- helpers ----------

function findGroupForTeam(
  tournament: Tournament,
  teamCode: string,
): GroupId | null {
  const g = tournament.groups.find((gp) => gp.team_ids.includes(teamCode));
  return g?.id ?? null;
}

function teamName(tournament: Tournament, code: string): string {
  return tournament.teams.find((t) => t.id === code)?.name ?? code;
}

function resultFor(
  prediction: MatchPrediction,
  teamIsHome: boolean,
): "W" | "D" | "L" {
  if (prediction.outcome === "draw") return "D";
  if (prediction.outcome === "home_win") return teamIsHome ? "W" : "L";
  // away_win
  return teamIsHome ? "L" : "W";
}

function pointsFor(result: "W" | "D" | "L" | "TBD"): number {
  if (result === "W") return 3;
  if (result === "D") return 1;
  return 0;
}

function positionInOrder(
  effective_order: readonly string[],
  teamCode: string,
): 1 | 2 | 3 | 4 | null {
  const idx = effective_order.indexOf(teamCode);
  if (idx < 0) return null;
  if (idx === 0) return 1;
  if (idx === 1) return 2;
  if (idx === 2) return 3;
  if (idx === 3) return 4;
  return null;
}

// ---------- main ----------

/**
 * Build a `GroupStageSummary` for `teamCode` from the user's per-match
 * `Bracket`. If the team isn't in the tournament, returns a degenerate
 * summary with `groupId: null` and no matches.
 */
export function buildGroupStageSummary(
  tournament: Tournament,
  bracket: Bracket,
  teamCode: string,
): GroupStageSummary {
  const groupId = findGroupForTeam(tournament, teamCode);
  if (!groupId) {
    return {
      teamCode,
      groupId: null,
      position: null,
      matches: [],
      totalPoints: 0,
      goalDiff: 0,
      hasAnyPick: false,
    };
  }

  const group = tournament.groups.find((g) => g.id === groupId)!;
  const groupFixtures = tournament.group_fixtures.filter(
    (f) => f.group_id === groupId,
  );
  // The fixtures involving this team, sorted by match_no to keep the
  // narrative linear (matchday 1 → 3).
  const myFixtures = groupFixtures
    .filter((f) => {
      const home = group.team_ids[f.home_idx];
      const away = group.team_ids[f.away_idx];
      return home === teamCode || away === teamCode;
    })
    .sort((a, b) => a.match_no - b.match_no);

  const matches: GroupMatchRow[] = myFixtures.map((f) => {
    const homeCode = group.team_ids[f.home_idx]!;
    const awayCode = group.team_ids[f.away_idx]!;
    const teamIsHome = homeCode === teamCode;
    const opponentCode = teamIsHome ? awayCode : homeCode;
    const matchId = String(f.match_no);
    const pred = bracket.matchPredictions[matchId];

    if (!pred) {
      return {
        matchId,
        opponentCode,
        opponentName: teamName(tournament, opponentCode),
        result: "TBD" as const,
        points: 0,
        teamScore: null,
        opponentScore: null,
      };
    }

    const result = resultFor(pred, teamIsHome);
    const hs = typeof pred.homeScore === "number" ? pred.homeScore : null;
    const as = typeof pred.awayScore === "number" ? pred.awayScore : null;
    const teamScore = teamIsHome ? hs : as;
    const opponentScore = teamIsHome ? as : hs;

    return {
      matchId,
      opponentCode,
      opponentName: teamName(tournament, opponentCode),
      result,
      points: pointsFor(result),
      teamScore,
      opponentScore,
    };
  });

  const totalPoints = matches.reduce((s, m) => s + m.points, 0);
  const goalDiff = matches.reduce((s, m) => {
    if (m.teamScore === null || m.opponentScore === null) return s;
    return s + (m.teamScore - m.opponentScore);
  }, 0);

  // Position from the computed standings, same logic the bracket UI
  // uses for the group table, so the molecule panel agrees with the
  // bracket's group view exactly.
  const tiebreaker = bracket.groupTiebreakers[groupId];
  const standings: readonly GroupStanding[] = computeGroupStandings(
    groupId,
    tournament,
    bracket.matchPredictions,
    tiebreaker,
  );
  const effectiveOrder = standings.map((s) => s.teamCode);
  const hasAnyPick = matches.some((m) => m.result !== "TBD");
  const position = hasAnyPick ? positionInOrder(effectiveOrder, teamCode) : null;

  return {
    teamCode,
    groupId,
    position,
    matches,
    totalPoints,
    goalDiff,
    hasAnyPick,
  };
}

/**
 * Friendly label for a position. "Topped Group A" / "Came 2nd in
 * Group A" / etc.
 */
export function positionLabel(
  position: 1 | 2 | 3 | 4 | null,
  groupId: GroupId | null,
): string {
  if (!groupId) return "Group stage";
  if (position === 1) return `Topped Group ${groupId}`;
  if (position === 2) return `Came 2nd in Group ${groupId}`;
  if (position === 3) return `Came 3rd in Group ${groupId}`;
  if (position === 4) return `Came 4th in Group ${groupId}`;
  return `Group ${groupId}`;
}

/**
 * Friendly rank pill, "1ST" / "2ND" / "3RD" / "4TH" / "-".
 */
export function rankPillLabel(position: 1 | 2 | 3 | 4 | null): string {
  if (position === 1) return "1ST";
  if (position === 2) return "2ND";
  if (position === 3) return "3RD";
  if (position === 4) return "4TH";
  return "-";
}
