/**
 * Pure helpers for assembling the 12-group teams grid + the upcoming-matches
 * list from the canonical data files. Tested in vitest.
 *
 * Source data:
 *   - `data/fifa-wc-2026/teams.json` , 48 teams w/ kit colours, world rank.
 *   - `data/fifa-wc-2026/fixtures.json`, 104 matches, real composition
 *     (post-2025-12-05 Final Draw + March 2026 play-off winners).
 */

import teamsData from "../../../../../../data/fifa-wc-2026/teams.json";
import fixturesData from "../../../../../../data/fifa-wc-2026/fixtures.json";

export interface Team {
  readonly code: string;
  readonly name: string;
  readonly short_name: string;
  readonly fifa_ranking_at_2026: number;
  readonly kit: { readonly primary: string; readonly secondary: string };
  readonly confederation: string;
}

export interface Fixture {
  readonly match_number: number;
  readonly stage: string;
  readonly home_team_slot: string;
  readonly away_team_slot: string;
  readonly host_city_id: string;
  readonly kickoff_utc: string;
}

export interface GroupBlock {
  /** Single uppercase letter "A" .. "L". */
  readonly id: string;
  readonly teams: readonly Team[];
}

export interface UpcomingMatch extends Fixture {
  readonly home: Team;
  readonly away: Team;
}

const ALL_TEAMS = (teamsData as { teams: Team[] }).teams;
const ALL_FIXTURES = (fixturesData as { fixtures: Fixture[] }).fixtures;

const TEAM_BY_CODE: ReadonlyMap<string, Team> = new Map(
  ALL_TEAMS.map((t) => [t.code, t]),
);

export function teamByCode(code: string): Team | undefined {
  return TEAM_BY_CODE.get(code);
}

export function allTeams(): readonly Team[] {
  return ALL_TEAMS;
}

/**
 * Build the 12 group blocks (A-L) from the fixtures file.
 * Each group has 4 teams. Teams within a group are returned in world-rank
 * order (best rank first) so the UI is stable.
 */
export function buildGroups(): readonly GroupBlock[] {
  const seen = new Map<string, Set<string>>();
  for (const fx of ALL_FIXTURES) {
    if (!fx.stage.startsWith("group_")) continue;
    const id = fx.stage.slice("group_".length).toUpperCase();
    if (!seen.has(id)) seen.set(id, new Set());
    seen.get(id)!.add(fx.home_team_slot);
    seen.get(id)!.add(fx.away_team_slot);
  }

  const blocks: GroupBlock[] = [];
  for (const id of [...seen.keys()].sort()) {
    const codes = [...seen.get(id)!];
    const teams = codes
      .map((c) => TEAM_BY_CODE.get(c))
      .filter((t): t is Team => t !== undefined)
      .sort((a, b) => a.fifa_ranking_at_2026 - b.fifa_ranking_at_2026);
    blocks.push({ id, teams });
  }
  return blocks;
}

/**
 * The first N matches (by kickoff time, ties broken by match_number).
 * Defaults to 12, matchday 1 of the group stage (12 groups × 1 match = 12).
 */
export function upcomingMatches(limit: number = 12): readonly UpcomingMatch[] {
  const sorted = [...ALL_FIXTURES]
    .filter((f) => f.stage.startsWith("group_"))
    .sort((a, b) => {
      const ta = Date.parse(a.kickoff_utc);
      const tb = Date.parse(b.kickoff_utc);
      if (ta !== tb) return ta - tb;
      return a.match_number - b.match_number;
    });

  const out: UpcomingMatch[] = [];
  for (const f of sorted) {
    if (out.length >= limit) break;
    const home = TEAM_BY_CODE.get(f.home_team_slot);
    const away = TEAM_BY_CODE.get(f.away_team_slot);
    if (!home || !away) continue;
    out.push({ ...f, home, away });
  }
  return out;
}

/**
 * First 3 group-stage fixtures for a given team code. Used in the
 * team-detail drawer.
 */
export function firstFixturesForTeam(code: string, limit: number = 3): readonly Fixture[] {
  return [...ALL_FIXTURES]
    .filter(
      (f) =>
        f.stage.startsWith("group_") &&
        (f.home_team_slot === code || f.away_team_slot === code),
    )
    .sort((a, b) => Date.parse(a.kickoff_utc) - Date.parse(b.kickoff_utc))
    .slice(0, limit);
}

/**
 * Synthetic "group winner probability" derived from world ranks within the
 * group. Real probabilities come from Polymarket later; this is a
 * deterministic placeholder so the chart isn't empty for launch.
 *
 * Algorithm: assign each team a weight of `1 / (rank^0.6)`, normalise. Higher
 * rank (smaller number) -> higher weight. The 0.6 exponent compresses the
 * spread so rank-1 teams aren't 95%+ favourites.
 */
export function syntheticGroupProbabilities(group: GroupBlock): readonly {
  team: Team;
  pct: number;
}[] {
  const weights = group.teams.map((t) => ({
    team: t,
    w: 1 / Math.pow(Math.max(1, t.fifa_ranking_at_2026), 0.6),
  }));
  const total = weights.reduce((acc, x) => acc + x.w, 0);
  return weights
    .map(({ team, w }) => ({ team, pct: Math.round((w / total) * 100) }))
    .sort((a, b) => b.pct - a.pct);
}
