import { describe, expect, it } from "vitest";

import {
  generateBots,
  regenerateBotPickForMatch,
  leafForBotPick,
} from "../src/generator.js";
import { Storage } from "../src/storage.js";
import { chalkStrategy } from "../src/strategy/chalk.js";
import type { MatchSpec } from "../src/types.js";

/**
 * v0.3.0 generator tests, regenerate-on-demand contract (Tim
 * 2026-06-08). The v0.2.0 tests asserted on bot/bot_pick rows;
 * those tables are gone. The new contract is:
 *
 *   - generateBots writes one swarm_run row, no per-bot rows
 *   - the same (seed, count) produces bit-identical merkle roots
 *   - regenerateBotPickForMatch is the source of truth for picks
 *     and is deterministic
 */

const MATCHES: MatchSpec[] = [
  {
    match_id: "m1",
    tournament_id: "t",
    home_team: "Argentina",
    away_team: "France",
    kickoff_utc: new Date(Date.now() + 60_000).toISOString(),
    allows_draw: true,
    odds: { home_win: 0.5, draw: 0.25, away_win: 0.25 },
  },
  {
    match_id: "m2",
    tournament_id: "t",
    home_team: "Brazil",
    away_team: "Germany",
    kickoff_utc: new Date(Date.now() + 120_000).toISOString(),
    allows_draw: false,
    odds: { home_win: 0.7, draw: 0, away_win: 0.3 },
  },
];

describe("generator (v0.3.0 regenerate-on-demand)", () => {
  it("writes one swarm_run row and emits per-match merkle roots", () => {
    const storage = new Storage({ path: ":memory:" });
    const result = generateBots(storage, MATCHES, {
      count: 50,
      seed: "test-seed",
    });
    expect(result.bots_generated).toBe(50);
    expect(result.picks_generated).toBe(50 * MATCHES.length);
    expect(result.total_bots_after).toBe(50);
    expect(Object.keys(result.per_match_roots).sort()).toEqual(["m1", "m2"]);

    // swarm_run table has exactly one row
    const swarms = storage.listSwarmRuns();
    expect(swarms).toHaveLength(1);
    expect(swarms[0]!.total_bots).toBe(50);
    expect(swarms[0]!.run_seed).toBe("test-seed");

    // cumulative bot count rolls up to the same number
    expect(storage.countBots()).toBe(50);

    storage.close();
  });

  it("regenerated picks honour allows_draw constraints", () => {
    const storage = new Storage({ path: ":memory:" });
    generateBots(storage, MATCHES, { count: 100, seed: "fixed" });

    // For every bot, regenerating its picks should honour the
    // match constraints. m2 forbids draws.
    for (let i = 0; i < 100; i++) {
      const pickKnockout = regenerateBotPickForMatch(
        "fixed",
        i,
        chalkStrategy,
        MATCHES[1]!,
      );
      expect(pickKnockout.outcome).not.toBe("draw");
    }
    storage.close();
  });

  it("same seed across two stores produces bit-identical merkle roots", () => {
    const a = new Storage({ path: ":memory:" });
    const b = new Storage({ path: ":memory:" });
    const ra = generateBots(a, MATCHES, { count: 25, seed: "fixed-seed" });
    const rb = generateBots(b, MATCHES, { count: 25, seed: "fixed-seed" });
    expect(ra.per_match_roots).toEqual(rb.per_match_roots);
    a.close();
    b.close();
  });

  it("different seeds produce different merkle roots", () => {
    const a = new Storage({ path: ":memory:" });
    const b = new Storage({ path: ":memory:" });
    const ra = generateBots(a, MATCHES, { count: 25, seed: "seed-a" });
    const rb = generateBots(b, MATCHES, { count: 25, seed: "seed-b" });
    expect(ra.per_match_roots).not.toEqual(rb.per_match_roots);
    a.close();
    b.close();
  });

  it("leafForBotPick is the compact <base36>+<h|d|a> format", () => {
    expect(leafForBotPick(0, "home_win")).toBe("0h");
    expect(leafForBotPick(35, "away_win")).toBe("za");
    expect(leafForBotPick(36, "draw")).toBe("10d");
  });
});
