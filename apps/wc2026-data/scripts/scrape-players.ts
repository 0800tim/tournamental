/**
 * Scrape + emit `apps/web/data/players-2026.json`.
 *
 * Reads the canonical seed at `data/fifa-wc-2026/players.json`, groups
 * players by `country` (the FIFA team code), enriches each team's roster
 * via the Wikidata scraper (mock by default; real with
 * `WC2026_DATA_BACKEND=real`), and writes the merged result.
 *
 * Idempotent: re-runs only refetch teams whose cache entry is older than
 * the cache age threshold (default 7 days). Per-team caches live at
 * `apps/wc2026-data/data/players-cache/<code>.json`.
 *
 * Usage:
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-players
 *   WC2026_DATA_BACKEND=real pnpm --filter @vtorn/wc2026-data-scripts scrape-players
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-players --teams=ARG,FRA
 *   pnpm --filter @vtorn/wc2026-data-scripts scrape-players --dry-run
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createScraper, MockScraper } from "../src/players/wikidata-scraper.js";
import type {
  EnrichedPlayer,
  PlayerDataset,
  SeedPlayer,
} from "../src/players/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(HERE, "..", "..", "..", "data", "fifa-wc-2026", "players.json");
const OUT_PATH = resolve(HERE, "..", "..", "web", "data", "players-2026.json");

interface SeedFile {
  readonly players: ReadonlyArray<{
    readonly player_id: string;
    readonly name: string;
    readonly number: number | null;
    readonly country: string;
    readonly wikidata_q: string | null;
  }>;
}

interface CliOpts {
  readonly teams: readonly string[] | null;
  readonly dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): CliOpts {
  let teams: string[] | null = null;
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--teams=")) {
      teams = a.slice("--teams=".length).split(",").map((s) => s.trim().toUpperCase());
    }
  }
  return { teams, dryRun };
}

export function readSeed(path = SEED_PATH): readonly SeedPlayer[] {
  const raw = readFileSync(path, "utf8");
  const file = JSON.parse(raw) as SeedFile;
  return file.players
    .filter((p) => p.wikidata_q !== null)
    .map(
      (p): SeedPlayer => ({
        playerId: p.player_id,
        name: p.name,
        code: p.country,
        wikidataQid: p.wikidata_q ?? "",
        shirtNumber: p.number ?? null,
      }),
    );
}

export function groupByCode(seed: readonly SeedPlayer[]): ReadonlyMap<string, readonly SeedPlayer[]> {
  const out = new Map<string, SeedPlayer[]>();
  for (const s of seed) {
    const arr = out.get(s.code) ?? [];
    arr.push(s);
    out.set(s.code, arr);
  }
  return out;
}

export async function runScrape(
  opts: CliOpts = { teams: null, dryRun: false },
  io: {
    seed?: readonly SeedPlayer[];
    write?: (path: string, body: string) => void;
    log?: (msg: string) => void;
  } = {},
): Promise<PlayerDataset> {
  const seed = io.seed ?? readSeed();
  const groups = groupByCode(seed);
  // Selected teams use the configured scraper (real or mock). Unselected
  // teams always go through the mock backend so the on-disk dataset stays
  // populated for *every* team — no half-empty file when Tim runs
  // `--teams=ARG` to enrich a single team.
  const primary = createScraper();
  const fallback = new MockScraper();
  const all: EnrichedPlayer[] = [];
  const log = io.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const filter = opts.teams ? new Set(opts.teams) : null;
  let realCount = 0;
  let mockCount = 0;
  for (const [code, players] of groups) {
    const useReal = !filter || filter.has(code);
    const scraper = useReal ? primary : fallback;
    log(`${useReal ? "scraping" : "mocking "} ${code} (${players.length} players)…`);
    const enriched = await scraper.scrapeTeam(code, players);
    if (useReal && process.env.WC2026_DATA_BACKEND === "real") realCount += enriched.length;
    else mockCount += enriched.length;
    all.push(...enriched);
  }
  // Source label: "wikidata" only when we actually hit Wikidata for *any*
  // team this run; otherwise "mock". Builds remain reproducible in CI.
  const source: PlayerDataset["source"] =
    realCount > 0 ? "wikidata" : "mock";
  const dataset: PlayerDataset = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    source,
    players: all.sort((a, b) => a.id.localeCompare(b.id)),
  };
  const body = JSON.stringify(dataset, null, 2) + "\n";
  if (opts.dryRun) {
    log(`dry-run: ${all.length} enriched players (would write ${OUT_PATH})`);
  } else {
    const writer = io.write ?? defaultWriter;
    writer(OUT_PATH, body);
    log(`wrote ${all.length} enriched players → ${OUT_PATH} (real=${realCount}, mock=${mockCount})`);
  }
  return dataset;
}

function defaultWriter(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

// Run when invoked directly (not when imported by tests).
const isDirectExec = (() => {
  try {
    const url = fileURLToPath(import.meta.url);
    return process.argv[1] && resolve(process.argv[1]) === resolve(url);
  } catch {
    return false;
  }
})();

if (isDirectExec) {
  const opts = parseArgs(process.argv.slice(2));
  runScrape(opts).catch((err) => {
    process.stderr.write(`scrape-players failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
