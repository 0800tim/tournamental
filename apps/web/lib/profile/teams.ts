/**
 * Team list for the favourite-team flag grid on /profile.
 *
 * The full team catalogue lives in `data/fifa-wc-2026/teams.json` (48
 * entries, world rankings included). This module exposes a lighter
 * shape — `{ code, name, fifaRank }` — sorted by world rank ascending
 * so the favourites land at the top of the grid by default.
 *
 * Flag SVGs live under `apps/web/public/flags/<CODE>.svg`. One file
 * per team, named by the 3-letter FIFA code.
 */

import teamsRaw from "@/../../data/fifa-wc-2026/teams.json";

export interface Team {
  /** 3-letter FIFA code, also the flag filename. */
  readonly code: string;
  readonly name: string;
  /** Lower is better. Used to sort the grid. */
  readonly fifaRank: number;
}

interface RawTeam {
  code: string;
  name: string;
  fifa_ranking_at_2026?: number;
}

const RAW = (teamsRaw as { teams: RawTeam[] }).teams;

/** All 48 confirmed WC 2026 teams, sorted by world rank (lowest = best). */
export const TEAMS: readonly Team[] = RAW
  .map((t) => ({
    code: t.code,
    name: t.name,
    fifaRank: t.fifa_ranking_at_2026 ?? 999,
  }))
  .sort((a, b) => a.fifaRank - b.fifaRank);

/** Resolve a team by FIFA code. Case-insensitive. */
export function findTeamByCode(code: string | null | undefined): Team | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return TEAMS.find((t) => t.code === c) ?? null;
}

/** Path to the team's flag SVG under /public. */
export function flagPath(teamCode: string): string {
  return `/flags/${teamCode.toUpperCase()}.svg`;
}
