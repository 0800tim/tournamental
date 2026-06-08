/**
 * ApiKeyStore , issuance, lookup, revocation.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3, §14
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GameStore } from "../src/store/db.js";
import {
  ApiKeyStore,
  generateApiKey,
  hashApiKey,
} from "../src/store/api-keys.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

let store: GameStore;
let keys: ApiKeyStore;

beforeEach(() => {
  store = new GameStore({ dbPath: ":memory:", migrationsDir: MIGRATIONS_DIR });
  keys = new ApiKeyStore(store.db);
});

afterEach(() => {
  store.close();
});

describe("generateApiKey + hashApiKey", () => {
  it("mints a 32-char tnm_ prefixed key", () => {
    const k = generateApiKey();
    expect(k).toMatch(/^tnm_[A-Za-z0-9_-]{32}$/);
  });

  it("hashApiKey returns a 64-hex-char sha256", () => {
    const h = hashApiKey("tnm_test_key");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashApiKey is stable", () => {
    expect(hashApiKey("abc")).toBe(hashApiKey("abc"));
  });
});

describe("ApiKeyStore", () => {
  it("issues a key with the default 1000-bot quota", () => {
    const issued = keys.issue({
      owner_email: "dev@example.com",
      label: "main",
    });
    expect(issued.api_key).toMatch(/^tnm_[A-Za-z0-9_-]{32}$/);
    expect(issued.quota_bots).toBe(1000);
    expect(issued.quota_picks_per_hour).toBe(100_000);
    expect(issued.owner_email).toBe("dev@example.com");
  });

  it("lifts the quota to 10,000 bots for .edu emails", () => {
    const issued = keys.issue({
      owner_email: "alice@cs.stanford.edu",
    });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("lifts the quota for .ac.uk emails", () => {
    const issued = keys.issue({ owner_email: "researcher@cl.cam.ac.uk" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("lifts the quota for .ac.nz emails", () => {
    const issued = keys.issue({ owner_email: "tim@auckland.ac.nz" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("lifts the quota for .edu.au emails", () => {
    const issued = keys.issue({ owner_email: "x@unimelb.edu.au" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("lifts the quota for .ac.za emails", () => {
    const issued = keys.issue({ owner_email: "y@uct.ac.za" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("lifts the quota for .edu.cn emails", () => {
    const issued = keys.issue({ owner_email: "z@tsinghua.edu.cn" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("lifts the quota for .ac.jp emails", () => {
    const issued = keys.issue({ owner_email: "a@u-tokyo.ac.jp" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("is case-insensitive when checking academic suffixes", () => {
    const issued = keys.issue({ owner_email: "MIXED@Stanford.EDU" });
    expect(issued.quota_bots).toBe(10_000);
  });

  it("returns the plaintext key only at issuance; subsequent lookup uses hash", () => {
    const { api_key, owner_email } = keys.issue({
      owner_email: "dev@example.com",
    });
    const found = keys.lookupByPlain(api_key);
    expect(found).not.toBeNull();
    expect(found!.owner_email).toBe(owner_email);
  });

  it("returns null when looking up an unknown plaintext key", () => {
    expect(keys.lookupByPlain("tnm_does_not_exist")).toBeNull();
  });

  it("returns null after revocation", () => {
    const { api_key } = keys.issue({ owner_email: "dev@example.com" });
    expect(keys.lookupByPlain(api_key)).not.toBeNull();
    keys.revoke(api_key);
    expect(keys.lookupByPlain(api_key)).toBeNull();
  });

  it("does not store the plaintext key anywhere", () => {
    const { api_key } = keys.issue({ owner_email: "dev@example.com" });
    const row = store.db
      .prepare(`SELECT * FROM api_key LIMIT 1`)
      .get() as Record<string, unknown>;
    // Walk every column and check no value equals the plaintext key.
    for (const v of Object.values(row)) {
      expect(typeof v === "string" ? v.includes(api_key.slice(4)) : false).toBe(
        false,
      );
    }
  });
});
