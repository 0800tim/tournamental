#!/usr/bin/env tsx
/**
 * GHL retry worker.
 *
 * Reads rows from `syndicates_pending_ghl` whose `next_attempt_at`
 * has passed, re-attempts the contact push, and either:
 *
 *   - deletes the row on success
 *   - increments `attempts` and bumps `next_attempt_at` with
 *     exponential back-off on failure
 *   - drops the row after `MAX_ATTEMPTS` so the queue doesn't grow
 *     forever (a row that's failed 8 times in 24 hours is almost
 *     certainly a permanent bad payload, not a transient network blip)
 *
 * Designed to be run from cron. Example crontab line (slash-15 in the
 * minutes column means "every 15 minutes"):
 *
 *   (every 15 min) cd APP_DIR && pnpm exec tsx scripts/ghl-retry.ts
 *
 * Idempotent: safe to run from multiple processes (better-sqlite3's
 * SQLite locking serialises them); safe to run on an empty queue
 * (returns immediately).
 *
 * Logs JSONL to stdout for ingestion. One line per processed row.
 */

import Database from "better-sqlite3";
import { resolve } from "node:path";

import { buildGhlContactPayload } from "../lib/syndicate/ghl";
import type { SyndicateRow } from "../lib/syndicate/persistence";

const DB_PATH = process.env.GAME_DB_PATH ?? "./apps/game/data/game.db";
const GHL_API_BASE_URL =
  process.env.GHL_API_BASE_URL ?? "https://services.leadconnectorhq.com";
const GHL_VERSION_HEADER = "2021-07-28";
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 15 * 60 * 1000; // 15 minutes
const BATCH_SIZE = 25;
const PUSH_TIMEOUT_MS = 5000;

interface PendingRow {
  id: number;
  syndicate_id: string;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  next_attempt_at: number;
}

function backoffMs(attempts: number): number {
  // 15min, 30min, 1h, 2h, 4h, 8h, 16h, 32h (capped at the MAX_ATTEMPTS row drop).
  return BASE_BACKOFF_MS * Math.pow(2, Math.min(attempts, 10));
}

interface LogLine {
  ts: number;
  level: "info" | "warn" | "error";
  msg: string;
  row_id?: number;
  syndicate_id?: string;
  attempts?: number;
  status?: string;
  error?: string;
}

function log(line: Omit<LogLine, "ts">): void {
  console.log(JSON.stringify({ ts: Date.now(), ...line }));
}

async function pushOnce(row: SyndicateRow): Promise<{
  ok: boolean;
  contactId?: string;
  error?: string;
}> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "GHL_API_KEY unset" };
  }
  const { body } = buildGhlContactPayload(row);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const res = await fetch(`${GHL_API_BASE_URL}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GHL_VERSION_HEADER,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `ghl ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      contact?: { id?: string };
      id?: string;
    };
    return { ok: true, contactId: json.contact?.id ?? json.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const dbPath = resolve(DB_PATH);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Tables not present (fresh DB, schema not migrated) → exit quietly.
  const exists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='syndicates_pending_ghl'`,
    )
    .get();
  if (!exists) {
    log({ level: "info", msg: "ghl-retry: no schema, exiting" });
    db.close();
    return;
  }

  const now = Date.now();
  const pending = db
    .prepare(
      `SELECT * FROM syndicates_pending_ghl
        WHERE next_attempt_at <= ?
        ORDER BY next_attempt_at ASC
        LIMIT ?`,
    )
    .all(now, BATCH_SIZE) as PendingRow[];

  if (pending.length === 0) {
    log({ level: "info", msg: "ghl-retry: queue empty" });
    db.close();
    return;
  }

  log({ level: "info", msg: "ghl-retry: batch start", attempts: pending.length });

  const deleteStmt = db.prepare(`DELETE FROM syndicates_pending_ghl WHERE id = ?`);
  const bumpStmt = db.prepare(
    `UPDATE syndicates_pending_ghl
        SET attempts = ?, last_error = ?, next_attempt_at = ?
      WHERE id = ?`,
  );
  const getSyndicateStmt = db.prepare(`SELECT * FROM syndicates WHERE id = ?`);

  for (const row of pending) {
    const syndicate = getSyndicateStmt.get(row.syndicate_id) as
      | SyndicateRow
      | undefined;
    if (!syndicate) {
      log({
        level: "warn",
        msg: "ghl-retry: syndicate missing, dropping",
        row_id: row.id,
        syndicate_id: row.syndicate_id,
      });
      deleteStmt.run(row.id);
      continue;
    }

    const nextAttempts = row.attempts + 1;
    const result = await pushOnce(syndicate);

    if (result.ok) {
      deleteStmt.run(row.id);
      log({
        level: "info",
        msg: "ghl-retry: synced",
        row_id: row.id,
        syndicate_id: row.syndicate_id,
        attempts: nextAttempts,
        status: "synced",
      });
      continue;
    }

    if (nextAttempts >= MAX_ATTEMPTS) {
      deleteStmt.run(row.id);
      log({
        level: "error",
        msg: "ghl-retry: max attempts reached, dropping",
        row_id: row.id,
        syndicate_id: row.syndicate_id,
        attempts: nextAttempts,
        error: result.error,
      });
      continue;
    }

    const nextAt = Date.now() + backoffMs(nextAttempts);
    bumpStmt.run(nextAttempts, result.error ?? "unknown", nextAt, row.id);
    log({
      level: "warn",
      msg: "ghl-retry: failed, will retry",
      row_id: row.id,
      syndicate_id: row.syndicate_id,
      attempts: nextAttempts,
      error: result.error,
    });
  }

  log({ level: "info", msg: "ghl-retry: batch complete" });
  db.close();
}

main().catch((err) => {
  log({
    level: "error",
    msg: "ghl-retry: unhandled error",
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
