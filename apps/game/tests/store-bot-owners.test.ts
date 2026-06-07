/**
 * BotOwnerStore , ownership claims, per-key counts, ownership checks.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.4, §7.2
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GameStore } from "../src/store/db.js";
import { ApiKeyStore } from "../src/store/api-keys.js";
import { BotOwnerStore } from "../src/store/bot-owners.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

let store: GameStore;
let keys: ApiKeyStore;
let owners: BotOwnerStore;

beforeEach(() => {
  store = new GameStore({ dbPath: ":memory:", migrationsDir: MIGRATIONS_DIR });
  keys = new ApiKeyStore(store.db);
  owners = new BotOwnerStore(store.db);
  store.db
    .prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`)
    .run("bot_a");
  store.db
    .prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`)
    .run("bot_b");
  store.db
    .prepare(`INSERT INTO users (id, created_at, is_bot) VALUES (?, 1, 1)`)
    .run("bot_c");
});

afterEach(() => store.close());

describe("BotOwnerStore", () => {
  it("records ownership and counts bots per key", () => {
    const issued = keys.issue({ owner_email: "dev@example.com" });
    owners.claim({
      bot_id: "bot_a",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
    });
    owners.claim({
      bot_id: "bot_b",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
    });
    expect(owners.countByApiKey(issued.key_hash)).toBe(2);
  });

  it("ownedBotIds returns the claimed bots in stable order", () => {
    const issued = keys.issue({ owner_email: "dev@example.com" });
    owners.claim({
      bot_id: "bot_a",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
      now: 100,
    });
    owners.claim({
      bot_id: "bot_b",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
      now: 200,
    });
    expect(owners.ownedBotIds(issued.key_hash)).toEqual(["bot_a", "bot_b"]);
  });

  it("isOwner is true for claimed bots, false otherwise", () => {
    const issued = keys.issue({ owner_email: "dev@example.com" });
    owners.claim({
      bot_id: "bot_a",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
    });
    expect(owners.isOwner(issued.key_hash, "bot_a")).toBe(true);
    expect(owners.isOwner(issued.key_hash, "bot_b")).toBe(false);
  });

  it("claim is idempotent on the same bot_id", () => {
    const issued = keys.issue({ owner_email: "dev@example.com" });
    owners.claim({
      bot_id: "bot_a",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
    });
    owners.claim({
      bot_id: "bot_a",
      api_key_hash: issued.key_hash,
      owner_email: issued.owner_email,
    });
    expect(owners.countByApiKey(issued.key_hash)).toBe(1);
  });

  it("counts bots only owned by the queried key", () => {
    const k1 = keys.issue({ owner_email: "a@example.com" });
    const k2 = keys.issue({ owner_email: "b@example.com" });
    owners.claim({
      bot_id: "bot_a",
      api_key_hash: k1.key_hash,
      owner_email: k1.owner_email,
    });
    owners.claim({
      bot_id: "bot_b",
      api_key_hash: k2.key_hash,
      owner_email: k2.owner_email,
    });
    owners.claim({
      bot_id: "bot_c",
      api_key_hash: k2.key_hash,
      owner_email: k2.owner_email,
    });
    expect(owners.countByApiKey(k1.key_hash)).toBe(1);
    expect(owners.countByApiKey(k2.key_hash)).toBe(2);
  });
});
