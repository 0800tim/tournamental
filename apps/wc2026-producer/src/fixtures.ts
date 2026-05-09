/**
 * Loads `data/fifa-wc-2026/fixtures.json` as the canonical source of truth
 * for what 2026 World Cup matches exist. Used by both replay-mode and
 * live-mode to validate match IDs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Fixture {
  match_number: number;
  stage: string;
  kickoff_utc: string;
  host_city_id: string;
  home_team_slot: string;
  away_team_slot: string;
}

export interface FixtureBundle {
  tournament: string;
  match_count: number;
  fixtures: Fixture[];
}

/** Repo-relative path: apps/wc2026-producer → ../../data/... */
const DEFAULT_FIXTURES_PATH = resolve(
  __dirname,
  "../../../data/fifa-wc-2026/fixtures.json",
);

export function loadFixtures(path: string = DEFAULT_FIXTURES_PATH): FixtureBundle {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as FixtureBundle;
}

export function findFixture(bundle: FixtureBundle, matchNumber: number): Fixture | undefined {
  return bundle.fixtures.find((f) => f.match_number === matchNumber);
}

export function fixturesByStage(bundle: FixtureBundle, stage: string): Fixture[] {
  return bundle.fixtures.filter((f) => f.stage === stage);
}
