#!/usr/bin/env node
/**
 * tournamental-seed-bots CLI
 *
 * Usage:
 *   pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --dry-run
 *   pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --apply
 *   pnpm --filter @tournamental/seed-bots run seed -- --purge
 *
 * Flags:
 *   --target=<n>   number of bots to roll (default 18000)
 *   --dry-run      print validation + summary, no DB writes
 *   --apply        write to all three stores (auth-sms users, identity
 *                  scores JSONL, game brackets)
 *   --purge        delete every `bot_%` row from all three stores
 *   --seed=<str>   override the master seed (default
 *                  `tournamental-2026-seed-v1`)
 *
 * Exit codes:
 *   0  success (or dry-run validation pass)
 *   1  validation failure (any of favourite_rate / draw_rate /
 *      top6_cup_winner_rate misses its target by >2pp)
 *   2  usage error (mutually exclusive flags etc)
 */

import {
  generateBots,
  summariseAvatars,
  summariseCountries,
  summariseEngagement,
  validateTargets,
} from "./seed.js";
import { purgeBots, writeBots } from "./write.js";

const DEFAULT_SEED = "tournamental-2026-seed-v1";

interface Args {
  target: number;
  seed: string;
  dryRun: boolean;
  apply: boolean;
  purge: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let target = 18000;
  let seed = DEFAULT_SEED;
  let dryRun = false;
  let apply = false;
  let purge = false;
  for (const a of argv) {
    if (a === "--") continue; // pnpm-style separator passthrough
    if (a === "--dry-run") dryRun = true;
    else if (a === "--apply") apply = true;
    else if (a === "--purge") purge = true;
    else if (a.startsWith("--target=")) {
      const n = Number(a.slice("--target=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --target: ${a}`);
      }
      target = Math.floor(n);
    } else if (a.startsWith("--seed=")) {
      seed = a.slice("--seed=".length);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (purge && (dryRun || apply)) {
    throw new Error("--purge cannot be combined with --dry-run / --apply");
  }
  if (!purge && !dryRun && !apply) {
    // Default to dry-run when nothing specified, to be conservative.
    dryRun = true;
  }
  return { target, seed, dryRun, apply, purge };
}

function fail(msg: string, code: number): never {
  process.stderr.write(`seed-bots: ${msg}\n`);
  process.exit(code);
}

function checkTarget(
  label: string,
  value: number,
  target: number,
  tolerance: number,
): boolean {
  const ok = Math.abs(value - target) <= tolerance;
  process.stdout.write(
    `  ${ok ? "PASS" : "FAIL"}  ${label}=${(value * 100).toFixed(2)}% (target ${(
      target * 100
    ).toFixed(0)}% +- ${(tolerance * 100).toFixed(0)}pp)\n`,
  );
  return ok;
}

async function main(): Promise<void> {
  let parsed: Args;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.purge) {
    const stats = purgeBots();
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    return;
  }

  const t0 = Date.now();
  const bots = generateBots({ seed: parsed.seed, target: parsed.target });
  const tGen = Date.now() - t0;

  const validation = validateTargets(bots);
  process.stdout.write("# Validation\n");
  const okFav = checkTarget(
    "favourite_rate",
    validation.favourite_rate,
    0.75,
    0.02,
  );
  const okDraw = checkTarget(
    "draw_rate (groups)",
    validation.draw_rate,
    0.15,
    0.02,
  );
  // Top-6 cup winner concentration is a one-sided floor; spec calls
  // for >= 82% so we report PASS when at or above.
  const okTop6 = validation.top6_cup_winner_rate >= 0.82;
  process.stdout.write(
    `  ${okTop6 ? "PASS" : "FAIL"}  top6_cup_winner_rate=${(
      validation.top6_cup_winner_rate * 100
    ).toFixed(2)}% (target >= 82%)\n`,
  );

  process.stdout.write("\n# Demographics\n");
  process.stdout.write(
    `  countries: ${JSON.stringify(summariseCountries(bots))}\n`,
  );
  process.stdout.write(
    `  avatars:   ${JSON.stringify(summariseAvatars(bots))}\n`,
  );
  process.stdout.write(
    `  engagement: ${JSON.stringify(summariseEngagement(bots))}\n`,
  );
  process.stdout.write(
    `  cup_winners: ${JSON.stringify(validation.cup_winner_distribution)}\n`,
  );
  process.stdout.write(
    `\n# Run\n  generated=${bots.length} elapsed_ms=${tGen} seed="${parsed.seed}"\n`,
  );

  if (!okFav || !okDraw || !okTop6) {
    fail("validation targets missed; refusing to write", 1);
  }

  if (parsed.dryRun) {
    process.stdout.write("\nDry-run complete (no DB writes).\n");
    return;
  }

  if (parsed.apply) {
    process.stdout.write("\nWriting to stores...\n");
    const stats = writeBots(bots);
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
  }
}

main().catch((err) => {
  fail((err as Error).stack ?? (err as Error).message, 1);
});
