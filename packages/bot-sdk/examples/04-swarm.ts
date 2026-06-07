/**
 * Example 4: 1,000-bot swarm.
 *
 * Spins up 1,000 bots with randomly-varied chalk weights. Demonstrates the
 * Swarm helper running with default concurrency (16). For 10k+ bots prefer
 * the low-level `submitBulkPicks` path which packs many bot ids into one
 * bulk request.
 *
 * Run:
 *   TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/04-swarm.ts
 */

import { Swarm, type OddsSnapshot, type Outcome } from "../src/index.js";

const MATCHES: OddsSnapshot[] = Array.from({ length: 48 }, (_, i) => ({
  match_id: `wc-2026-g${String(i + 1).padStart(2, "0")}`,
  home_win: 0.4 + Math.random() * 0.2,
  draw: 0.25,
  away_win: 0.35 - Math.random() * 0.1,
}));

function weightedPick(odds: OddsSnapshot, rng: () => number): Outcome {
  const total = odds.home_win + odds.draw + odds.away_win;
  const roll = rng() * total;
  if (roll < odds.home_win) return "home_win";
  if (roll < odds.home_win + odds.draw) return "draw";
  return "away_win";
}

function seedRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey) {
    console.error("Set TOURNAMENTAL_API_KEY to run this example.");
    process.exit(1);
  }
  const botIds = Array.from({ length: 1000 }, (_, i) => `swarm-${i}`);
  const swarm = new Swarm({ apiKey, botIds, concurrency: 16 });
  const stats = await swarm.eachBot(async (bot) => {
    const rng = seedRng(
      Number.parseInt(bot.botId.split("-")[1] ?? "0", 10) || 1,
    );
    for (const m of MATCHES) bot.pick(m.match_id, weightedPick(m, rng));
  });
  console.log(
    `swarm complete: bots=${stats.bots} ok=${stats.ok} failed=${stats.failed}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("04-swarm.ts")) {
  void main();
}

export { weightedPick, seedRng };
