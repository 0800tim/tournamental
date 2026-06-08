/**
 * commitKickoff , builds a merkle root over (bot/user, match, outcome,
 * locked_at) leaves for a single kickoff event, stamps each included
 * bracket with the commit timestamp, and emits the root to the OTS
 * poster. Phase 1 forward-compat hook for the Phase 2 federation work.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GameStore } from "../src/store/db.js";
import {
  commitKickoff,
  type CommitKickoffResult,
} from "../src/services/kickoff-commit.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

let store: GameStore;
beforeEach(() => {
  store = new GameStore({ dbPath: ":memory:", migrationsDir: MIGRATIONS_DIR });
  // Seed three users with picks for match "1".
  const lockedAt = 1_700_000_000_000;
  for (const [id, isBot, outcome] of [
    ["u_h1", 0, "home_win"],
    ["bot_b1", 1, "draw"],
    ["bot_b2", 1, "away_win"],
  ] as const) {
    store.db
      .prepare(
        `INSERT INTO users (id, created_at, is_bot) VALUES (?, ?, ?)`,
      )
      .run(id, lockedAt, isBot);
    store.db
      .prepare(
        `INSERT INTO brackets
           (id, user_id, tournament_id, payload_json, locked_at,
            score_total, share_guid)
         VALUES (?, ?, 'fifa-wc-2026', ?, ?, 0, ?)`,
      )
      .run(
        `${id}_b`,
        id,
        JSON.stringify({
          bracketId: `${id}_b`,
          matchPredictions: {
            "1": { matchId: "1", outcome, lockedAt: "2024-01-01T00:00:00Z" },
          },
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        }),
        lockedAt,
        id.slice(0, 8),
      );
  }
});
afterEach(() => store.close());

describe("commitKickoff", () => {
  it("posts a 64-hex merkle root over the picks for that match", async () => {
    const posted: string[] = [];
    const result: CommitKickoffResult = await commitKickoff({
      store,
      tournament_id: "fifa-wc-2026",
      match_id: "1",
      committed_at_utc: 1_700_000_001_000,
      postOts: async (root) => {
        posted.push(root);
      },
    });
    expect(result.root).toMatch(/^[0-9a-f]{64}$/);
    expect(posted).toEqual([result.root]);
    expect(result.leaf_count).toBe(3);
  });

  it("stamps committed_at_utc on every bracket that contributed a pick", async () => {
    await commitKickoff({
      store,
      tournament_id: "fifa-wc-2026",
      match_id: "1",
      committed_at_utc: 1_700_000_001_000,
      postOts: async () => {
        // no-op
      },
    });
    const rows = store.db
      .prepare(
        `SELECT user_id, committed_at_utc FROM brackets
           WHERE tournament_id = 'fifa-wc-2026' ORDER BY user_id`,
      )
      .all() as Array<{ user_id: string; committed_at_utc: number | null }>;
    for (const row of rows) {
      expect(row.committed_at_utc).toBe(1_700_000_001_000);
    }
  });

  it("does not include picks for matches other than the one being committed", async () => {
    // Add a bracket whose pick is for match "2"; the commit for "1"
    // must not pick it up.
    store.db
      .prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`)
      .run("bot_other_match");
    store.db
      .prepare(
        `INSERT INTO brackets
           (id, user_id, tournament_id, payload_json, locked_at,
            score_total, share_guid)
         VALUES (?, ?, 'fifa-wc-2026', ?, 1, 0, ?)`,
      )
      .run(
        "bot_other_match_b",
        "bot_other_match",
        JSON.stringify({
          bracketId: "x",
          matchPredictions: {
            "2": { matchId: "2", outcome: "home_win", lockedAt: "" },
          },
          groupTiebreakers: {},
          knockoutPredictions: {},
          version: 1,
        }),
        "bot_othe",
      );
    const result = await commitKickoff({
      store,
      tournament_id: "fifa-wc-2026",
      match_id: "1",
      committed_at_utc: 1_700_000_001_000,
      postOts: async () => {},
    });
    expect(result.leaf_count).toBe(3);
  });

  it("produces a canonical empty-tree root if no picks for the match", async () => {
    const result = await commitKickoff({
      store,
      tournament_id: "fifa-wc-2026",
      match_id: "no_such_match",
      committed_at_utc: 1_700_000_001_000,
      postOts: async () => {},
    });
    expect(result.leaf_count).toBe(0);
    expect(result.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two commits for the same match with the same picks produce the same root", async () => {
    const noopPost = async () => {};
    const r1 = await commitKickoff({
      store,
      tournament_id: "fifa-wc-2026",
      match_id: "1",
      committed_at_utc: 1,
      postOts: noopPost,
    });
    const r2 = await commitKickoff({
      store,
      tournament_id: "fifa-wc-2026",
      match_id: "1",
      committed_at_utc: 2,
      postOts: noopPost,
    });
    expect(r1.root).toBe(r2.root);
  });
});
