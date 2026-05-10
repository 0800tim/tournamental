/**
 * Tournamental 2026 World Cup producer scaffold.
 *
 * Two modes:
 *   - replay-mode: emit a spec-conformant stream by replaying a historic
 *     match equivalent to the requested 2026 fixture.
 *   - live-mode: stub that documents the live data partner contract.
 *
 * CLI:
 *   wc2026-producer --mode replay --match-number 1
 *   wc2026-producer --mode live --match-number 1   # throws "unconfigured"
 *   wc2026-producer --list-fixtures
 */

import { findFixture, fixturesByStage, loadFixtures } from "./fixtures.js";
import { pickReplaySource } from "./replay-mode.js";
import { UnconfiguredLiveAdapter } from "./live-mode.js";

interface CliArgs {
  mode: "replay" | "live";
  matchNumber: number | null;
  listFixtures: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { mode: "replay", matchNumber: null, listFixtures: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i] as CliArgs["mode"];
    else if (a === "--match-number") args.matchNumber = Number(argv[++i]);
    else if (a === "--list-fixtures") args.listFixtures = true;
  }
  return args;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const bundle = loadFixtures();

  if (args.listFixtures) {
    for (const f of bundle.fixtures.slice(0, 10)) {
      process.stdout.write(
        `${String(f.match_number).padStart(3)}  ${f.stage.padEnd(12)}  ${f.kickoff_utc}  ${f.host_city_id.padEnd(20)}  ${f.home_team_slot} vs ${f.away_team_slot}\n`,
      );
    }
    process.stdout.write(`(${bundle.match_count} total — showing first 10)\n`);
    return 0;
  }

  if (args.matchNumber === null) {
    process.stderr.write("error: --match-number required\n");
    return 1;
  }

  const fixture = findFixture(bundle, args.matchNumber);
  if (!fixture) {
    process.stderr.write(`error: match ${args.matchNumber} not in fixtures\n`);
    return 1;
  }

  if (args.mode === "replay") {
    const source = pickReplaySource(fixture);
    process.stdout.write(JSON.stringify(source, null, 2) + "\n");
    return 0;
  }

  // mode === "live"
  const adapter = new UnconfiguredLiveAdapter();
  const supported = await adapter.supports(fixture);
  process.stdout.write(
    JSON.stringify({ adapter: adapter.id, supported }, null, 2) + "\n",
  );
  return supported ? 0 : 2;
}

// Side-effect-free import guard for tests; only run when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}

export { fixturesByStage, loadFixtures, findFixture };
