/**
 * QuotaStore , sliding-hour pick quota ledger.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.4
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { GameStore } from "../src/store/db.js";
import { QuotaStore } from "../src/store/quotas.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

let store: GameStore;
let q: QuotaStore;

beforeEach(() => {
  store = new GameStore({ dbPath: ":memory:", migrationsDir: MIGRATIONS_DIR });
  q = new QuotaStore(store.db);
});

afterEach(() => store.close());

describe("QuotaStore", () => {
  it("starts at 0 used for an unseen key", () => {
    expect(q.usedThisHour("k1")).toBe(0);
  });

  it("accumulates picks in the current hour window", () => {
    q.consume("k1", 50);
    q.consume("k1", 50);
    expect(q.usedThisHour("k1")).toBe(100);
  });

  it("tracks separate keys independently", () => {
    q.consume("k1", 50);
    q.consume("k2", 25);
    expect(q.usedThisHour("k1")).toBe(50);
    expect(q.usedThisHour("k2")).toBe(25);
  });

  it("tryConsume accepts requests under the cap", () => {
    expect(q.tryConsume("k1", 100, 200)).toBe(true);
    expect(q.tryConsume("k1", 99, 200)).toBe(true);
    expect(q.usedThisHour("k1")).toBe(199);
  });

  it("tryConsume rejects when total would exceed the cap", () => {
    expect(q.tryConsume("k1", 100, 100)).toBe(true);
    expect(q.tryConsume("k1", 1, 100)).toBe(false);
    expect(q.usedThisHour("k1")).toBe(100);
  });

  it("rejects requests that exceed the cap on their own", () => {
    expect(q.tryConsume("k1", 200, 100)).toBe(false);
    expect(q.usedThisHour("k1")).toBe(0);
  });

  it("clamps the window to the floor of the current hour", () => {
    const at = 1_717_804_800_000; // arbitrary fixed instant
    q.consumeAt("k1", 10, at);
    q.consumeAt("k1", 10, at + 60_000);
    q.consumeAt("k1", 10, at + 59 * 60_000);
    expect(q.usedThisHourAt("k1", at)).toBe(30);
  });

  it("new hour starts a fresh window", () => {
    const at = 1_717_804_800_000;
    q.consumeAt("k1", 50, at);
    expect(q.usedThisHourAt("k1", at)).toBe(50);
    // Next hour window has zero usage.
    expect(q.usedThisHourAt("k1", at + 3_600_000)).toBe(0);
  });
});
