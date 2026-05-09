/**
 * Loads the canonical FIFA WC 2026 team and fixture data shipped under
 * `data/fifa-wc-2026/`. The data is read at process start and cached;
 * tests can pass a custom `dataDir` to load fixtures.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Team {
  code: string;
  name: string;
  short_name: string;
  fifa_ranking_at_2026: number | null;
  confederation: string;
  flag_emoji: string;
}

export interface Fixture {
  match_number: number;
  stage: string;
  home_team_slot: string;
  away_team_slot: string;
  kickoff_utc: string;
  host_city_id: string;
}

export interface DataPack {
  teams: Team[];
  byCode: Map<string, Team>;
  /** Lower-cased team-name index for fuzzy matching against external feeds. */
  byNameLc: Map<string, Team>;
  fixtures: Fixture[];
  byMatchNumber: Map<number, Fixture>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export function defaultDataDir(): string {
  // Compiled dist/ path: apps/odds-ingest/dist/data.js → ../../../data/fifa-wc-2026
  // Source-mode (tsx): apps/odds-ingest/src/data.ts  → ../../../data/fifa-wc-2026
  return resolve(__dirname, "../../../data/fifa-wc-2026");
}

export function loadDataPack(dataDir: string = defaultDataDir()): DataPack {
  const teamsRaw = JSON.parse(readFileSync(resolve(dataDir, "teams.json"), "utf8")) as {
    teams: Team[];
  };
  const fixturesRaw = JSON.parse(
    readFileSync(resolve(dataDir, "fixtures.json"), "utf8"),
  ) as { fixtures: Fixture[] };

  const teams = teamsRaw.teams;
  const byCode = new Map<string, Team>();
  const byNameLc = new Map<string, Team>();
  for (const t of teams) {
    byCode.set(t.code, t);
    byNameLc.set(t.name.toLowerCase(), t);
    byNameLc.set(t.short_name.toLowerCase(), t);
  }

  // Common alias entries — useful for noisy external feeds. Keep this small;
  // the `normalise` module owns the bigger alias table.
  const aliases: Array<[string, string]> = [
    ["usa", "USA"],
    ["us", "USA"],
    ["united states", "USA"],
    ["united states of america", "USA"],
    ["south africa", "RSA"],
    ["south korea", "KOR"],
    ["korea republic", "KOR"],
    ["republic of korea", "KOR"],
    ["czech republic", "CZE"],
    ["czechia", "CZE"],
    ["iran", "IRN"],
    ["ivory coast", "CIV"],
    ["côte d'ivoire", "CIV"],
    ["cote d'ivoire", "CIV"],
    ["dr congo", "COD"],
    ["democratic republic of the congo", "COD"],
    ["congo dr", "COD"],
    ["dr-congo", "COD"],
    ["cape verde", "CPV"],
    ["curacao", "CUW"],
    ["curaçao", "CUW"],
    ["bosnia and herzegovina", "BIH"],
    ["bosnia & herzegovina", "BIH"],
    ["bosnia-herzegovina", "BIH"],
    ["bosnia herzegovina", "BIH"],
    ["bosnia", "BIH"],
    ["saudi arabia", "KSA"],
    ["new zealand", "NZL"],
    ["netherlands", "NED"],
    ["holland", "NED"],
    ["the netherlands", "NED"],
    ["turkey", "TUR"],
    ["turkiye", "TUR"],
    ["türkiye", "TUR"],
    ["england", "ENG"],
  ];
  for (const [alias, code] of aliases) {
    const t = byCode.get(code);
    if (t) {
      byNameLc.set(alias, t);
      // Also index a hyphen-collapsed and space-collapsed variant so feeds
      // that use either separator hit the same team.
      const dashSwapped = alias.replace(/[-]/g, " ");
      if (dashSwapped !== alias) byNameLc.set(dashSwapped, t);
    }
  }

  const byMatchNumber = new Map<number, Fixture>();
  for (const f of fixturesRaw.fixtures) {
    byMatchNumber.set(f.match_number, f);
  }

  return { teams, byCode, byNameLc, fixtures: fixturesRaw.fixtures, byMatchNumber };
}
