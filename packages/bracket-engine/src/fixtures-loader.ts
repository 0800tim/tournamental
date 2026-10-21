/**
 * Convenience loaders for the vendored fixture JSON files: the 2026
 * FIFA World Cup and the 2027 Men's Rugby World Cup. `loadFixtures(id)`
 * picks by tournament id; the per-tournament functions stay for callers
 * that want the typed `_meta`.
 *
 * The JSON file is a structural description of the tournament — it has a
 * `_meta` block documenting its source, a list of placeholder teams (real
 * teams when FIFA's draw is finalised), 8 groups of 6 with placeholder
 * fixtures, and the full knockout slot graph with declarative
 * dependencies. Swapping in real teams and real kickoff times is a JSON
 * replacement; no engine code changes.
 */

import type { Tournament } from "./tournament.js";

// Standard JSON import — relies on tsconfig `resolveJsonModule`. Works
// across Node 20+ and Next 14 webpack. Consumers of the package can
// also load the JSON themselves and pass it to a Tournament directly.
import fixtures2026 from "../data/fifa-wc-2026-fixtures.json";
import annexC2026 from "../data/fifa-2026-annex-c-assignments.json";
import fixturesRwc2027 from "../data/rwc-2027-fixtures.json";

export interface Fixtures2026 extends Tournament {
  readonly _meta: {
    readonly source: string;
    readonly source_url: string;
    readonly schedule_status: "placeholder" | "official";
    readonly fetched_at_utc: string;
    readonly notes: string;
  };
}

export function loadFixtures2026(): Fixtures2026 {
  // Merge the Annex C lookup table onto the Tournament. The table is
  // kept in its own JSON because (a) it's 87 KB on its own and (b) it
  // is sourced separately (FIFA Competition Regulations Annex C) so
  // changes to it ship independently of the fixture schedule.
  // Values in the raw JSON are encoded as e.g. "3H" (third-placer of
  // group H); we strip the "3" prefix on load so the in-memory shape
  // matches the GroupId convention used everywhere else.
  const base = fixtures2026 as unknown as Fixtures2026;
  const raw = annexC2026 as { assignments: Record<string, Record<string, string>> };
  const normalised: Record<string, Record<string, string>> = {};
  for (const [key, inner] of Object.entries(raw.assignments)) {
    const innerOut: Record<string, string> = {};
    for (const [k, v] of Object.entries(inner)) {
      innerOut[k] = v.replace(/^[34]/, "");
    }
    normalised[key] = innerOut;
  }
  return {
    ...base,
    annex_c_assignments: normalised as Fixtures2026["annex_c_assignments"],
  } as Fixtures2026;
}

export interface FixturesRwc2027 extends Tournament {
  readonly _meta: Fixtures2026["_meta"];
}

/**
 * Men's Rugby World Cup 2027: 24 teams in six pools of four, a round of
 * 16 fed by the top two per pool and the four best thirds (routed by
 * the published permutation table, carried as `annex_c_assignments`),
 * then quarter-finals, semi-finals, the bronze final and the final.
 * `sport` is `rugby_union`, so the standings computer applies 4-2-0
 * with bonus points and the World Rugby tiebreak chain.
 */
export function loadFixturesRwc2027(): FixturesRwc2027 {
  return fixturesRwc2027 as unknown as FixturesRwc2027;
}

export type VendoredTournamentId = "fifa-wc-2026" | "rwc-2027";

export const VENDORED_TOURNAMENT_IDS: readonly VendoredTournamentId[] = ["fifa-wc-2026", "rwc-2027"];

/** The vendored tournament with this id; throws for any other id. */
export function loadFixtures(tournamentId: VendoredTournamentId): Fixtures2026 | FixturesRwc2027 {
  switch (tournamentId) {
    case "fifa-wc-2026":
      return loadFixtures2026();
    case "rwc-2027":
      return loadFixturesRwc2027();
    default:
      throw new Error(`loadFixtures: no vendored fixtures for "${String(tournamentId)}"`);
  }
}
