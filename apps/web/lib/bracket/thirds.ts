/**
 * Best third-placed teams, sized and ordered by the tournament's rules.
 *
 * Three surfaces used to hard-code the FIFA 2026 shape (eight of twelve
 * thirds, ranked by FIFA rank or by goals): the official-results path,
 * the molecule's consensus bracket and the thirds picker. Rugby World
 * Cup 2027 takes four of six thirds and ranks them by points difference,
 * points scored, tries scored and then World Rugby ranking, so every
 * consumer now reads the count from `advancement.wildcard_third` and the
 * order from the engine's cross-group comparator.
 *
 * Pure functions, no IO.
 */

import {
  compareStandingsAcrossGroups,
  standingsRulesFor,
  type GroupStanding,
  type Team,
  type TeamId,
  type TiebreakCriterion,
  type Tournament,
} from "@tournamental/bracket-engine";

/** How many third-placed teams advance; 0 when the format has none. */
export function bestThirdsTarget(tournament: Pick<Tournament, "advancement">): number {
  return Math.max(0, tournament.advancement.wildcard_third);
}

/**
 * The world ranking used for ordering and labels. `world_rank` is the
 * sport-neutral field; `fifa_rank` is what the 2026 data carries. 99
 * when neither is known so unranked teams sort last. (The engine's own
 * `world_rank` criterion treats an unranked team as negative infinity,
 * so a team ranked 100 or worse would sort below an unranked one here;
 * no vendored team is ranked worse than 89.)
 */
export function teamWorldRank(
  team: Pick<Team, "fifa_rank" | "world_rank"> | undefined,
): number {
  if (!team) return 99;
  if (typeof team.world_rank === "number") return team.world_rank;
  if (typeof team.fifa_rank === "number") return team.fifa_rank;
  return 99;
}

export interface ThirdCandidate {
  readonly groupId: string;
  readonly standing: GroupStanding;
}

/**
 * Order third-placed teams best first: points, then the tournament's
 * thirds tiebreak chain (the engine comparator), then world ranking as
 * a stand-in for the unmodelled disciplinary and drawing-of-lots steps,
 * then team code so the order is total. Returns a new array.
 */
export function rankThirds<T extends ThirdCandidate>(
  tournament: Tournament,
  candidates: readonly T[],
): T[] {
  const compare = compareStandingsAcrossGroups(standingsRulesFor(tournament), tournament.teams);
  const byId = new Map(tournament.teams.map((t) => [t.id, t]));
  const rankOf = (id: TeamId): number => teamWorldRank(byId.get(id));
  return [...candidates].sort(
    (a, b) =>
      compare(a.standing, b.standing) ||
      rankOf(a.standing.teamCode) - rankOf(b.standing.teamCode) ||
      a.standing.teamCode.localeCompare(b.standing.teamCode),
  );
}

/** The best thirds in order, cut to the tournament's count. */
export function selectBestThirds(
  tournament: Tournament,
  candidates: readonly ThirdCandidate[],
): TeamId[] {
  return rankThirds(tournament, candidates)
    .slice(0, bestThirdsTarget(tournament))
    .map((c) => c.standing.teamCode);
}

/** Short label for the ranking authority, for tile badges and copy. */
export function rankingLabel(tournament: Pick<Tournament, "sport">): {
  readonly short: string;
  readonly long: string;
  readonly body: string;
} {
  switch (tournament.sport) {
    case "rugby_union":
      return { short: "WR", long: "World Rugby ranking", body: "World Rugby" };
    case "rugby_league":
      // The IRL publishes rugby league's rankings; no league tournament
      // is vendored yet, so the label is a placeholder until one is.
      return { short: "IRL", long: "IRL ranking", body: "the IRL" };
    case "football":
    case undefined:
    default:
      return { short: "FR", long: "FIFA rank", body: "FIFA" };
  }
}

/**
 * Plain-English names for the criteria the organiser applies when
 * ranking thirds across groups, in order, for the picker's explainer.
 * Head-to-head criteria never apply across groups and are skipped.
 */
export function thirdsTiebreakLabels(tournament: Tournament): string[] {
  const rules = standingsRulesFor(tournament);
  const chain: readonly TiebreakCriterion[] = rules.thirds_tiebreak ?? rules.tiebreak;
  const football = tournament.sport === undefined || tournament.sport === "football";
  const out: string[] = [];
  for (const c of chain) {
    switch (c) {
      case "score_diff":
        out.push(football ? "goal difference" : "points difference");
        break;
      case "score_for":
        out.push(football ? "goals scored" : "points scored");
        break;
      case "try_diff":
        out.push("try difference");
        break;
      case "try_for":
        out.push("tries scored");
        break;
      case "world_rank":
        out.push(rankingLabel(tournament).long);
        break;
      case "h2h_winner":
      case "h2h_table":
        break;
    }
  }
  return out;
}

function isThirdSlot(kind: string): boolean {
  return kind === "annex_c_third" || kind === "best_third";
}

const STAGE_LABEL: Record<string, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
};

/**
 * The knockout round the best thirds are routed into: the stage of the
 * first fixture with an `annex_c_third` or `best_third` slot, as a
 * human label.
 */
export function thirdsEntryStageLabel(tournament: Tournament): string {
  const entry = tournament.knockouts.find(
    (k) => isThirdSlot(k.home.kind) || isThirdSlot(k.away.kind),
  );
  if (!entry) return "the knockout rounds";
  return STAGE_LABEL[entry.stage] ?? entry.stage;
}
