import { describe, expect, it } from "vitest";

import { generateBots } from "../src/generator.js";
import { Storage } from "../src/storage.js";
import type { MatchSpec } from "../src/types.js";

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

describe("generator", () => {
  it("materialises N bots and locks one pick per match per bot", () => {
    const storage = new Storage({ path: ":memory:" });
    const result = generateBots(storage, MATCHES, {
      count: 50,
      seed: "test-seed",
    });
    expect(result.bots_inserted).toBe(50);
    expect(result.picks_inserted).toBe(50 * MATCHES.length);
    expect(storage.countBots()).toBe(50);

    const picks = storage.listPicksForMatch("m2");
    expect(picks.length).toBe(50);
    for (const p of picks) {
      expect(p.outcome).not.toBe("draw"); // m2 is a knockout, no draws allowed
    }
    storage.close();
  });

  it("is deterministic given the same seed", () => {
    const a = new Storage({ path: ":memory:" });
    const b = new Storage({ path: ":memory:" });
    generateBots(a, MATCHES, { count: 25, seed: "fixed-seed", now: () => 100 });
    generateBots(b, MATCHES, { count: 25, seed: "fixed-seed", now: () => 100 });
    const aPicks = a.listPicksForMatch("m1").map((p) => `${p.bot_id}:${p.outcome}`);
    const bPicks = b.listPicksForMatch("m1").map((p) => `${p.bot_id}:${p.outcome}`);
    expect(aPicks).toEqual(bPicks);
    a.close();
    b.close();
  });

  it("produces different bots when seed differs", () => {
    const a = new Storage({ path: ":memory:" });
    const b = new Storage({ path: ":memory:" });
    generateBots(a, MATCHES, { count: 25, seed: "seed-a" });
    generateBots(b, MATCHES, { count: 25, seed: "seed-b" });
    const aIds = a.listBotIds();
    const bIds = b.listBotIds();
    expect(aIds).not.toEqual(bIds);
    a.close();
    b.close();
  });

  it("scales to 5000 bots in a reasonable time on this box", () => {
    const storage = new Storage({ path: ":memory:" });
    const start = Date.now();
    const res = generateBots(storage, MATCHES, { count: 5_000, seed: "perf" });
    const elapsed = Date.now() - start;
    expect(res.bots_inserted).toBe(5_000);
    // Generous upper bound; we generate 10k picks here.
    expect(elapsed).toBeLessThan(5_000);
    storage.close();
  });
});
