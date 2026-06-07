/**
 * Perfect-bracket-track alert service tests.
 *
 * Verifies the "still alive past match 80" detection logic, idempotent
 * alert recording, and the optional webhook fan-out.
 *
 * Spec: A13 task brief.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameStore } from "../src/store/db.js";
import {
  PERFECT_TRACK_MATCH_THRESHOLD,
  runPerfectTrackWatch,
} from "../src/services/perfect-track-watch.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

const VALID_ROOT = "a".repeat(64);

function makeStore(): GameStore {
  return new GameStore({
    dbPath: ":memory:",
    migrationsDir: MIGRATIONS_DIR,
  });
}

function seedSummary(
  store: GameStore,
  operator_id: string,
  alive: ReadonlyArray<{ n: number; alive_count: number }>,
  overrides: Partial<{
    kickoff_at: number;
    total_bots: number;
    best_bot_score: number;
  }> = {},
) {
  store.swarmSummaries.upsert({
    operator_id,
    kickoff_at: overrides.kickoff_at ?? 1_700_000_000_000,
    total_bots: overrides.total_bots ?? 1000,
    bots_alive_after_match_n: alive,
    best_bot_score: overrides.best_bot_score ?? 0,
    top_k: [],
    merkle_root: VALID_ROOT,
    generated_at: Date.now(),
  });
}

describe("runPerfectTrackWatch", () => {
  let store: GameStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  it("threshold is 80", () => {
    expect(PERFECT_TRACK_MATCH_THRESHOLD).toBe(80);
  });

  it("emits no alerts when no summary crosses match 80", () => {
    seedSummary(store, "a".repeat(64), [
      { n: 1, alive_count: 1000 },
      { n: 50, alive_count: 100 },
      { n: 79, alive_count: 10 },
    ]);

    const result = runPerfectTrackWatch({
      store,
      now: Date.now(),
      webhookUrl: null,
    });

    expect(result.alertsRecorded).toHaveLength(0);
    expect(store.perfectTrackAlerts.listAll()).toHaveLength(0);
  });

  it("emits an alert when a summary has alive bots at match 80+", () => {
    const operator = "a".repeat(64);
    seedSummary(store, operator, [
      { n: 70, alive_count: 50 },
      { n: 80, alive_count: 3 },
      { n: 90, alive_count: 1 },
    ]);

    const result = runPerfectTrackWatch({
      store,
      now: 1_700_000_999_000,
      webhookUrl: null,
    });

    expect(result.alertsRecorded).toHaveLength(1);
    expect(result.alertsRecorded[0]).toMatchObject({
      operator_id: operator,
      match_number: 90,
      alive_count: 1,
    });

    const rows = store.perfectTrackAlerts.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detected_at).toBe(1_700_000_999_000);
  });

  it("ignores alive_count = 0 even at match 80+", () => {
    seedSummary(store, "a".repeat(64), [{ n: 80, alive_count: 0 }]);
    const result = runPerfectTrackWatch({
      store,
      now: Date.now(),
      webhookUrl: null,
    });
    expect(result.alertsRecorded).toHaveLength(0);
  });

  it("picks the highest matching n per operator", () => {
    seedSummary(store, "a".repeat(64), [
      { n: 80, alive_count: 100 },
      { n: 85, alive_count: 50 },
      { n: 90, alive_count: 5 },
    ]);
    const result = runPerfectTrackWatch({
      store,
      now: Date.now(),
      webhookUrl: null,
    });
    expect(result.alertsRecorded).toHaveLength(1);
    expect(result.alertsRecorded[0]?.match_number).toBe(90);
    expect(result.alertsRecorded[0]?.alive_count).toBe(5);
  });

  it("is idempotent on re-run for the same (operator, match) pair", () => {
    const operator = "b".repeat(64);
    seedSummary(store, operator, [{ n: 85, alive_count: 10 }]);

    runPerfectTrackWatch({ store, now: 1000, webhookUrl: null });
    runPerfectTrackWatch({ store, now: 2000, webhookUrl: null });

    const rows = store.perfectTrackAlerts.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detected_at).toBe(2000); // updated, not duplicated
  });

  it("emits one alert per operator", () => {
    seedSummary(store, "a".repeat(64), [{ n: 81, alive_count: 5 }]);
    seedSummary(store, "b".repeat(64), [{ n: 82, alive_count: 2 }]);
    seedSummary(store, "c".repeat(64), [{ n: 50, alive_count: 99 }]); // no alert

    const result = runPerfectTrackWatch({
      store,
      now: Date.now(),
      webhookUrl: null,
    });
    expect(result.alertsRecorded).toHaveLength(2);
  });

  it("POSTs to the webhook url when alerts fire", async () => {
    const operator = "a".repeat(64);
    seedSummary(store, operator, [{ n: 81, alive_count: 7 }]);

    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof url === "string" ? url : url.toString(),
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return new Response("", { status: 200 });
    });

    const result = runPerfectTrackWatch({
      store,
      now: 1234,
      webhookUrl: "https://webhook.example.com/alerts",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    expect(result.webhookPosted).toBe(1);
    // Allow microtask drain.
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://webhook.example.com/alerts");
    expect(calls[0]?.body).toMatchObject({
      event: "perfect_track_alert",
      operator_id: operator,
      match_number: 81,
      alive_count: 7,
    });
  });

  it("does not POST when webhookUrl is null", () => {
    seedSummary(store, "a".repeat(64), [{ n: 90, alive_count: 1 }]);
    const fakeFetch = vi.fn();
    const result = runPerfectTrackWatch({
      store,
      now: Date.now(),
      webhookUrl: null,
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(result.webhookPosted).toBe(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("latestSummary rolls up to the highest match across operators", () => {
    seedSummary(store, "a".repeat(64), [{ n: 81, alive_count: 5 }]);
    seedSummary(store, "b".repeat(64), [{ n: 90, alive_count: 2 }]);
    seedSummary(store, "c".repeat(64), [{ n: 90, alive_count: 3 }]);

    runPerfectTrackWatch({ store, now: Date.now(), webhookUrl: null });

    const summary = store.perfectTrackAlerts.latestSummary();
    expect(summary).not.toBeNull();
    expect(summary!.highest_match).toBe(90);
    expect(summary!.total_alive).toBe(5); // 2 + 3 at match 90
    expect(summary!.operator_count).toBe(2);
  });
});
