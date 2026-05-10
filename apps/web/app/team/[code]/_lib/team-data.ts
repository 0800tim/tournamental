/**
 * Pure helpers for assembling everything the `/team/[code]` page needs:
 *   - canonical team metadata (name, FIFA rank, kit, confederation, manager)
 *   - the team's group letter (if grouped)
 *   - the team's group fixtures (computed standings opponents)
 *   - upcoming + recent fixtures for the team
 *   - stub recent-form (W/D/L) entries
 *   - stub 23-player squad
 *
 * All helpers are pure and synchronous. Consumed by the `team/[code]/page.tsx`
 * server component (and by the vitest suite directly).
 *
 * TODO(live-data): the form + squad files are stubs. Wire to a live results
 * API (football-data.org / FIFA) and FIFA's official squad-list endpoint at
 * the 2026-06-01 squad-deadline.
 */

import type { Team as BracketTeam, Tournament } from "@vtorn/bracket-engine";

import canonicalTeams from "../../../../../../data/fifa-wc-2026/teams.json";
import canonicalFixtures from "../../../../../../data/fifa-wc-2026/fixtures.json";
import teamForm from "../../../../data/team-form.json";
import teamSquads from "../../../../data/team-squads.json";

// ---------- canonical types ----------

export interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly short_name: string;
  readonly confederation: string;
  readonly fifa_ranking_at_2026: number;
  readonly flag_emoji?: string;
  readonly kit: { readonly primary: string; readonly secondary: string };
  readonly manager?: string;
  readonly wikidata_q?: string;
}

export interface CanonicalFixture {
  readonly match_number: number;
  readonly stage: string;
  readonly home_team_slot: string;
  readonly away_team_slot: string;
  readonly host_city_id: string;
  readonly kickoff_utc: string;
  readonly venue?: string;
}

const ALL_CANONICAL_TEAMS = (canonicalTeams as { teams: CanonicalTeam[] }).teams;
const ALL_CANONICAL_FIXTURES = (canonicalFixtures as { fixtures: CanonicalFixture[] }).fixtures;

const CANONICAL_BY_CODE: ReadonlyMap<string, CanonicalTeam> = new Map(
  ALL_CANONICAL_TEAMS.map((t) => [t.code, t]),
);

export function canonicalTeamByCode(code: string): CanonicalTeam | undefined {
  return CANONICAL_BY_CODE.get(code.toUpperCase());
}

// ---------- group + fixtures ----------

/**
 * The single-letter group id for a team, e.g. "J" for Argentina, or
 * undefined if the team isn't in any drawn group (placeholder slot).
 */
export function groupForTeam(tournament: Tournament, code: string): string | undefined {
  const upper = code.toUpperCase();
  for (const g of tournament.groups) {
    if (g.team_ids.includes(upper)) return g.id;
  }
  return undefined;
}

export interface TeamFixtureRow {
  readonly matchId: string;
  readonly stage: string;
  readonly groupId?: string;
  readonly opponentCode: string;
  readonly home: boolean;
  readonly kickoffUtc: string;
  readonly venue?: string;
}

/**
 * All fixtures involving the given team, in chronological order. Pulled from
 * the canonical `data/fifa-wc-2026/fixtures.json` (which already lists real
 * team codes for the group stage; knockout slots are still placeholders so
 * they're filtered out here).
 */
export function teamFixtures(code: string): readonly TeamFixtureRow[] {
  const upper = code.toUpperCase();
  const rows: TeamFixtureRow[] = [];
  for (const f of ALL_CANONICAL_FIXTURES) {
    const isHome = f.home_team_slot === upper;
    const isAway = f.away_team_slot === upper;
    if (!isHome && !isAway) continue;
    const opponent = isHome ? f.away_team_slot : f.home_team_slot;
    if (!CANONICAL_BY_CODE.has(opponent)) continue; // skip TBD-slot opponents
    rows.push({
      matchId: String(f.match_number),
      stage: f.stage,
      groupId: f.stage.startsWith("group_")
        ? f.stage.slice("group_".length).toUpperCase()
        : undefined,
      opponentCode: opponent,
      home: isHome,
      kickoffUtc: f.kickoff_utc,
      venue: f.venue,
    });
  }
  rows.sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
  return rows;
}

/**
 * The team's next fixture (relative to a reference instant — defaults to
 * "now"). Returns undefined if no upcoming fixtures exist.
 */
export function nextFixture(
  code: string,
  nowMs: number = Date.now(),
): TeamFixtureRow | undefined {
  return teamFixtures(code).find((f) => Date.parse(f.kickoffUtc) >= nowMs);
}

// ---------- group standings context ----------

export interface GroupOpponent {
  readonly code: string;
  readonly name: string;
  readonly fifaRank: number;
  readonly kit?: { readonly primary?: string; readonly secondary?: string };
}

/**
 * The other teams in the same group as `code` (by FIFA-rank ascending).
 * Used both to render the mini-standings strip and to seed the
 * head-to-head section.
 */
export function groupOpponents(
  tournament: Tournament,
  code: string,
): readonly GroupOpponent[] {
  const upper = code.toUpperCase();
  const gid = groupForTeam(tournament, upper);
  if (!gid) return [];
  const grp = tournament.groups.find((g) => g.id === gid);
  if (!grp) return [];
  const teamMap = new Map(tournament.teams.map((t) => [t.id, t]));
  return grp.team_ids
    .filter((id) => id !== upper)
    .map((id) => {
      const t = teamMap.get(id);
      const c = CANONICAL_BY_CODE.get(id);
      if (!t) return null;
      return {
        code: id,
        name: t.name,
        fifaRank: t.fifa_rank,
        kit: c?.kit ?? t.kit,
      } as GroupOpponent;
    })
    .filter((x): x is GroupOpponent => x !== null)
    .sort((a, b) => a.fifaRank - b.fifaRank);
}

// ---------- recent form ----------

export interface FormGame {
  readonly date: string;
  readonly opponent: string;
  readonly home: boolean;
  readonly goals_for: number;
  readonly goals_against: number;
  readonly result: "W" | "D" | "L";
  readonly competition: string;
}

const FORM_BY_CODE = (teamForm as { teams: Record<string, FormGame[]> }).teams;

export function recentForm(code: string): readonly FormGame[] {
  return FORM_BY_CODE[code.toUpperCase()] ?? [];
}

// ---------- squad ----------

export interface SquadPlayer {
  readonly jersey: number;
  readonly name: string;
  readonly position: "GK" | "DF" | "MF" | "FW";
  readonly captain: boolean;
}

const SQUAD_BY_CODE = (teamSquads as { teams: Record<string, SquadPlayer[]> }).teams;

export function squadForTeam(code: string): readonly SquadPlayer[] {
  return SQUAD_BY_CODE[code.toUpperCase()] ?? [];
}

// ---------- bracket-engine team helper ----------

export function bracketEngineTeam(
  tournament: Tournament,
  code: string,
): BracketTeam | undefined {
  const upper = code.toUpperCase();
  return tournament.teams.find((t) => t.id === upper);
}
