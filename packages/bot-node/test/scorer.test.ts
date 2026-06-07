import { describe, expect, it } from "vitest";

import { generateBots } from "../src/generator.js";
import { commitMatch } from "../src/scheduler.js";
import { scoreMatch } from "../src/scorer.js";
import { Storage } from "../src/storage.js";
import type { MatchSpec } from "../src/types.js";

function freshMatches(): MatchSpec[] {
  return [
    {
      match_id: "score-1",
      tournament_id: "t",
      home_team: "Argentina",
      away_team: "France",
      kickoff_utc: new Date(Date.now() + 5 * 60_000).toISOString(),
      allows_draw: true,
      odds: { home_win: 0.6, draw: 0.2, away_win: 0.2 },
    },
    {
      match_id: "score-2",
      tournament_id: "t",
      home_team: "Brazil",
      away_team: "Germany",
      kickoff_utc: new Date(Date.now() + 10 * 60_000).toISOString(),
      allows_draw: false,
      odds: { home_win: 0.55, draw: 0, away_win: 0.45 },
    },
  ];
}

describe("scorer", () => {
  it("counts correct bots and tracks still-perfect across multiple matches", async () => {
    const storage = new Storage({ path: ":memory:" });
    const matches = freshMatches();
    generateBots(storage, matches, { count: 100, seed: "score-test" });

    for (const m of matches) {
      await commitMatch({ storage, match: m, dry_run: true });
    }

    const r1 = await scoreMatch({
      storage,
      result: {
        match_id: "score-1",
        outcome: "home_win",
        resolved_at_utc: new Date().toISOString(),
      },
      dry_run: true,
    });
    expect(r1.total_bots).toBe(100);
    expect(r1.bots_correct).toBeGreaterThan(0);
    expect(r1.bots_correct).toBeLessThanOrEqual(100);
    expect(r1.bots_still_perfect).toBe(r1.bots_correct);
    expect(r1.top_n).toBeGreaterThan(0);

    const r2 = await scoreMatch({
      storage,
      result: {
        match_id: "score-2",
        outcome: "away_win",
        resolved_at_utc: new Date().toISOString(),
      },
      dry_run: true,
    });
    expect(r2.total_bots).toBe(100);
    // Still-perfect can only shrink or stay the same after another scored match.
    expect(r2.bots_still_perfect).toBeLessThanOrEqual(r1.bots_still_perfect);
    storage.close();
  });

  it("commits produce a merkle root that is stable across re-runs", async () => {
    const matches = freshMatches();
    const a = new Storage({ path: ":memory:" });
    const b = new Storage({ path: ":memory:" });
    generateBots(a, matches, { count: 50, seed: "fixed", now: () => 1_000 });
    generateBots(b, matches, { count: 50, seed: "fixed", now: () => 1_000 });
    const aCommit = await commitMatch({
      storage: a,
      match: matches[0]!,
      dry_run: true,
      now: () => 2_000,
    });
    const bCommit = await commitMatch({
      storage: b,
      match: matches[0]!,
      dry_run: true,
      now: () => 2_000,
    });
    expect(aCommit.merkle_root).toEqual(bCommit.merkle_root);
    expect(aCommit.bot_count).toBe(50);
    a.close();
    b.close();
  });

  it("refuses to commit a match that is already past kickoff", async () => {
    const storage = new Storage({ path: ":memory:" });
    const past: MatchSpec = {
      match_id: "past",
      tournament_id: "t",
      home_team: "A",
      away_team: "B",
      kickoff_utc: new Date(Date.now() - 60_000).toISOString(),
      allows_draw: true,
      odds: { home_win: 0.5, draw: 0.25, away_win: 0.25 },
    };
    generateBots(storage, [past], { count: 5, seed: "past" });
    await expect(
      commitMatch({ storage, match: past, dry_run: true }),
    ).rejects.toThrow(/after kickoff/);
    storage.close();
  });
});
