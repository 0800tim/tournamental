/**
 * Team-data enrichment, merge the canonical `data/fifa-wc-2026/teams.json`
 * (kit colours + emoji flags + manager + confederation) onto the bracket-
 * engine Tournament's `teams[]`, which only has the prediction-relevant
 * fields.
 *
 * Cache policy: this is a server-side helper that runs once per page load
 * (the page is statically generated). No runtime caching needed.
 */

import type { Team, Tournament } from "@vtorn/bracket-engine";

export interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly flag_emoji?: string;
  readonly kit?: {
    readonly primary?: string;
    readonly secondary?: string;
  };
}

export interface CanonicalTeamsFile {
  readonly teams: readonly CanonicalTeam[];
}

export function enrichTournamentTeams(
  tournament: Tournament,
  canonical: CanonicalTeamsFile,
): Tournament {
  const byCode = new Map(canonical.teams.map((t) => [t.code, t]));
  const teams: Team[] = tournament.teams.map((t) => {
    const c = byCode.get(t.id);
    if (!c) return t;
    return {
      ...t,
      kit: c.kit,
      flag_emoji: c.flag_emoji,
    };
  });
  return { ...tournament, teams };
}
