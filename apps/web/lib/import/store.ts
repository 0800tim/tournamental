/**
 * Direct sqlite access for the bracket-import audit table.
 *
 * Same pattern as `apps/web/lib/invite/store.ts`: apps/web reaches
 * into game.db via better-sqlite3 because the audit rows live next to
 * the brackets they describe, and pulling them through a game-service
 * HTTP indirection adds no value.
 *
 * Read-write: we INSERT audit rows on every import attempt + UPDATE
 * brackets to set the provenance columns when a commit succeeds.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Database, { type Database as DB } from "better-sqlite3";

import type { ImportSource, ParseResult } from "./types";

let _db: DB | null = null;

function resolveDbPath(): string {
  const explicit = process.env.VTORN_GAME_DB_PATH || process.env.GAME_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, "apps/game/data/game.db");
}

export function importDb(): DB | null {
  if (_db) return _db;
  const p = resolveDbPath();
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[import/store] game.db not found at ${p}`);
    return null;
  }
  _db = new Database(p);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  try {
    _db.prepare("SELECT 1 FROM bracket_import_audit LIMIT 1").get();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[import/store] bracket_import_audit missing; restart vtorn-game-prod to run migration 0012 (${err instanceof Error ? err.message : err})`,
    );
    return null;
  }
  return _db;
}

function nanoId(prefix: string): string {
  const r = randomBytes(12).toString("hex").slice(0, 20);
  return `${prefix}_${r}`;
}

export type AuditStatus = "parsed" | "partial" | "failed" | "committed";

export interface AuditWriteArgs {
  userId: string;
  bracketId: string | null;
  source: ImportSource;
  sourceUrl: string;
  httpStatus: number | null;
  status: AuditStatus;
  parsedJson: ParseResult | null;
  rawHtml: string | null;
  error: string | null;
}

/**
 * Cache the raw source HTML on disk (under
 * `apps/game/data/import-html/<sha>.html`) and return the hash + path
 * so the audit row can point at it without inflating sqlite. Returns
 * { sha, path: null } when rawHtml is null. Best-effort: a write
 * failure logs to console but never aborts the import.
 */
function cacheRawHtml(rawHtml: string | null): { sha: string | null; path: string | null } {
  if (!rawHtml) return { sha: null, path: null };
  const sha = createHash("sha256").update(rawHtml).digest("hex");
  try {
    const root = resolve(process.cwd(), "..", "..");
    const dir = resolve(root, "apps/game/data/import-html");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `${sha}.html`);
    if (!existsSync(path)) {
      writeFileSync(path, rawHtml, "utf-8");
    }
    return { sha, path };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[import/store] couldn't cache raw HTML:", err);
    return { sha, path: null };
  }
}

export function writeAudit(args: AuditWriteArgs): string {
  const db = importDb();
  if (!db) {
    // Soft fail: surface a fake id so callers don't hard-error in
    // dev environments where the migration hasn't run. The audit row
    // is best-effort defence-in-depth, not the source of truth.
    return "ia_unwritten";
  }
  const id = nanoId("ia");
  const { sha, path } = cacheRawHtml(args.rawHtml);
  db.prepare(
    `INSERT INTO bracket_import_audit
       (id, user_id, bracket_id, source, source_url, fetched_at, status,
        http_status, parsed_json, raw_html_sha256, raw_html_path, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    args.userId,
    args.bracketId,
    args.source,
    args.sourceUrl,
    Date.now(),
    args.status,
    args.httpStatus,
    args.parsedJson ? JSON.stringify(args.parsedJson) : null,
    sha,
    path,
    args.error,
  );
  return id;
}

export function markBracketImported(args: {
  bracketId: string;
  source: ImportSource;
  sourceUrl: string;
}): boolean {
  const db = importDb();
  if (!db) return false;
  const res = db
    .prepare(
      `UPDATE brackets
       SET imported_source = ?, imported_from_url = ?, imported_at = ?
       WHERE id = ?`,
    )
    .run(args.source, args.sourceUrl, Date.now(), args.bracketId);
  return res.changes === 1;
}

/** True when the user has already imported into this bracket. We
 *  enforce one import per bracket (see docs/69 §6). */
export function bracketAlreadyImported(bracketId: string): boolean {
  const db = importDb();
  if (!db) return false;
  const row = db
    .prepare("SELECT imported_source FROM brackets WHERE id = ?")
    .get(bracketId) as { imported_source: string | null } | undefined;
  return !!(row && row.imported_source);
}
