/**
 * Bot Arena migration smoke test.
 *
 * Ensures migration 0013 lands the new columns + tables required by
 * the Phase 1 Open Bot Arena and the Phase 2 federation hooks.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §8.1, §15.6
 */
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { GameStore } from "../src/store/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

describe("bot arena migration (0013)", () => {
  it("creates bot_owner, api_key, quota_window, federated_node, federated_leaderboard_snapshot", () => {
    const store = new GameStore({
      dbPath: ":memory:",
      migrationsDir: MIGRATIONS_DIR,
    });
    const db = store.db;
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("bot_owner");
    expect(tables).toContain("api_key");
    expect(tables).toContain("quota_window");
    expect(tables).toContain("federated_node");
    expect(tables).toContain("federated_leaderboard_snapshot");
    store.close();
  });

  it("adds is_bot to users and committed_at_utc to brackets", () => {
    const store = new GameStore({
      dbPath: ":memory:",
      migrationsDir: MIGRATIONS_DIR,
    });
    const db = store.db;
    const userCols = db
      .prepare(`PRAGMA table_info(users)`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(userCols).toContain("is_bot");

    const bracketCols = db
      .prepare(`PRAGMA table_info(brackets)`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(bracketCols).toContain("committed_at_utc");
    store.close();
  });

  it("creates the supporting indices", () => {
    const store = new GameStore({
      dbPath: ":memory:",
      migrationsDir: MIGRATIONS_DIR,
    });
    const db = store.db;
    const indices = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(indices).toContain("idx_users_is_bot");
    expect(indices).toContain("idx_brackets_committed_at");
    expect(indices).toContain("idx_bot_owner_email");
    expect(indices).toContain("idx_bot_owner_key");
    expect(indices).toContain("idx_api_key_owner");
    expect(indices).toContain("idx_federated_node_owner");
    expect(indices).toContain("idx_fed_snapshot_match");
    store.close();
  });
});
