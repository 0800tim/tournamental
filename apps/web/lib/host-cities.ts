/**
 * Host-city lookup, thin wrapper over the canonical
 * `data/fifa-wc-2026/host-cities.json` file.
 *
 *   - `hostCityById(id)` returns the rich `HostCity` record (city,
 *     country, real stadium name, FIFA tournament name, capacity, IANA
 *     timezone, coords) for a given fixture's `host_city_id`.
 *   - `allHostCities()` is mostly for tests / migrations; production
 *     pages should look up by id.
 *
 * Synchronous, O(1) after module load. Safe to call from server
 * components and client components alike.
 */

import raw from "../../../data/fifa-wc-2026/host-cities.json";
import rawFixtures from "../../../data/fifa-wc-2026/fixtures.json";

export interface HostCity {
  readonly id: string;
  readonly city: string;
  /** ISO-3166 alpha-2, e.g. "MX", "US", "CA". */
  readonly country: string;
  /** Real-world stadium name, e.g. "Estadio Azteca". */
  readonly stadium: string;
  /** FIFA-imposed tournament name, e.g. "Estadio Banorte". May equal
   * `stadium` if FIFA hasn't renamed it. */
  readonly stadium_tournament_name: string;
  readonly capacity: number;
  /** IANA timezone, e.g. "America/Mexico_City". */
  readonly timezone: string;
  /** [lat, lon]. Typed loosely so it round-trips the raw JSON without
   * a tuple-narrowing cast; consumers should index `[0]`/`[1]`. */
  readonly coords: readonly number[];
}

interface HostCitiesFile {
  readonly host_cities: readonly HostCity[];
}

const ALL: readonly HostCity[] = (raw as HostCitiesFile).host_cities;
const BY_ID: ReadonlyMap<string, HostCity> = new Map(
  ALL.map((c) => [c.id, c]),
);

export function hostCityById(id: string | null | undefined): HostCity | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function allHostCities(): readonly HostCity[] {
  return ALL;
}

// ---------- match number → host city ----------

interface CanonicalFixtureRow {
  readonly match_number: number;
  readonly host_city_id?: string;
  readonly kickoff_utc?: string;
}

interface FixturesFile {
  readonly fixtures: readonly CanonicalFixtureRow[];
}

const ALL_FIXTURES: readonly CanonicalFixtureRow[] =
  (rawFixtures as FixturesFile).fixtures;

const HOST_CITY_BY_MATCH_NO: ReadonlyMap<number, string> = new Map(
  ALL_FIXTURES
    .filter((f): f is CanonicalFixtureRow & { host_city_id: string } =>
      typeof f.host_city_id === "string" && f.host_city_id.length > 0,
    )
    .map((f) => [f.match_number, f.host_city_id]),
);

const KICKOFF_BY_MATCH_NO: ReadonlyMap<number, string> = new Map(
  ALL_FIXTURES
    .filter((f): f is CanonicalFixtureRow & { kickoff_utc: string } =>
      typeof f.kickoff_utc === "string" && f.kickoff_utc.length > 0,
    )
    .map((f) => [f.match_number, f.kickoff_utc]),
);

/**
 * Convenience helper for the bracket UI: resolves a fixture's
 * `match_number` (1..104 in FIFA 2026) directly to its rich
 * `HostCity` record. Bracket-engine `GroupFixture` / `KnockoutFixture`
 * only carry the stadium name string, not the host-city id, so the
 * row's parents call this to populate the `hostCity` prop.
 */
export function hostCityByMatchNumber(matchNumber: number): HostCity | undefined {
  const id = HOST_CITY_BY_MATCH_NO.get(matchNumber);
  return id ? hostCityById(id) : undefined;
}

/**
 * Kickoff ISO timestamp for a fixture's `match_number`. Useful for
 * `KnockoutMatch`, where the upstream `CascadedKnockout` strips the
 * kickoff field and the component needs it to render the new venue
 * footer lozenge without a parent-prop change.
 */
export function kickoffIsoByMatchNumber(matchNumber: number): string | undefined {
  return KICKOFF_BY_MATCH_NO.get(matchNumber);
}
