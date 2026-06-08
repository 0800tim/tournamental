/**
 * GameStore wiring smoke test , the Bot Arena DAOs land on the store
 * and the scope-filtered leaderboard read returns what you'd expect.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5, §6
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GameStore } from "../src/store/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

let store: GameStore;
beforeEach(() => {
  store = new GameStore({ dbPath: ":memory:", migrationsDir: MIGRATIONS_DIR });
});
afterEach(() => store.close());

describe("GameStore , wired DAOs", () => {
  it("exposes apiKeys, botOwners, quotas, federatedNodes", () => {
    expect(store.apiKeys).toBeDefined();
    expect(store.botOwners).toBeDefined();
    expect(store.quotas).toBeDefined();
    expect(store.federatedNodes).toBeDefined();
  });

  it("apiKeys.issue + lookupByPlain round-trips", () => {
    const issued = store.apiKeys.issue({ owner_email: "dev@example.com" });
    expect(store.apiKeys.lookupByPlain(issued.api_key)).not.toBeNull();
  });
});

describe("GameStore.topNByScope", () => {
  beforeEach(() => {
    const now = Date.now();
    for (const [id, is_bot, score] of [
      ["u_h1", 0, 50],
      ["u_h2", 0, 40],
      ["u_h3", 0, 30],
      ["bot_b1", 1, 70],
      ["bot_b2", 1, 60],
    ] as Array<[string, 0 | 1, number]>) {
      store.db
        .prepare(
          `INSERT INTO users (id, created_at, is_bot) VALUES (?, ?, ?)`,
        )
        .run(id, now, is_bot);
      store.db
        .prepare(
          `INSERT INTO brackets
             (id, user_id, tournament_id, payload_json, locked_at,
              score_total, share_guid)
           VALUES (?, ?, 'fifa-wc-2026', '{}', ?, ?, ?)`,
        )
        .run(`${id}_b`, id, now, score, id.slice(0, 8));
    }
  });

  it("humans scope returns only is_bot=0 users", () => {
    const rows = store.topNByScope("fifa-wc-2026", "humans", 10);
    expect(rows.map((r) => r.user_id)).toEqual(["u_h1", "u_h2", "u_h3"]);
  });

  it("bots scope returns only is_bot=1 users", () => {
    const rows = store.topNByScope("fifa-wc-2026", "bots", 10);
    expect(rows.map((r) => r.user_id)).toEqual(["bot_b1", "bot_b2"]);
  });

  it("all scope returns everyone, top score first", () => {
    const rows = store.topNByScope("fifa-wc-2026", "all", 10);
    expect(rows[0]?.user_id).toBe("bot_b1");
    expect(rows.length).toBe(5);
  });
});
