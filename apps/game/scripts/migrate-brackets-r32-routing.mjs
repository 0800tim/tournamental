#!/usr/bin/env node
/**
 * One-off migration for the FIFA Annex C R32 routing fix (2026-06-01).
 *
 * Before:  brackets stored knockoutPredictions against a wrong R32
 *          structure (4 R32 matches paired thirds-vs-thirds; 1A faced
 *          group A's runner-up; etc.). Picks reference those matchups.
 * After:   R32 is rewritten to FIFA's official structure with 8 group-
 *          winner-vs-3rd-placer slots routed by FIFA Annex C.
 *
 * What this script does:
 *   - For every bracket with version < 3:
 *       - Clear `knockoutPredictions` (so the user re-picks against the
 *         correct R32 structure).
 *       - Reset `bestThirds` to [] (added in v3 schema).
 *       - Bump `version` to 3.
 *   - Group-stage picks (matchPredictions) are preserved untouched.
 *
 * Usage:
 *   node scripts/migrate-brackets-r32-routing.mjs                    # dry-run
 *   node scripts/migrate-brackets-r32-routing.mjs --apply            # write
 *   GAME_DB_PATH=/path/to/game.db node ... --apply                   # custom path
 */

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const dbPath =
  process.env.GAME_DB_PATH ||
  process.env.VTORN_GAME_DB_PATH ||
  resolve(process.cwd(), "apps/game/data/game.db");

if (!existsSync(dbPath)) {
  console.error(`game.db not found at ${dbPath}`);
  process.exit(1);
}

console.error(`Reading ${dbPath} (${APPLY ? "WRITE" : "dry-run"})`);
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const rows = db
  .prepare(`SELECT id, user_id, tournament_id, payload_json, locked_at FROM brackets`)
  .all();

let candidates = 0;
let withKnockouts = 0;
let parseFailures = 0;
const samples = [];

const updateStmt = db.prepare(
  `UPDATE brackets SET payload_json = ? WHERE id = ?`,
);

const tx = db.transaction(() => {
  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch (err) {
      parseFailures++;
      continue;
    }
    const v = typeof payload.version === "number" ? payload.version : 0;
    if (v >= 3) continue;
    candidates++;
    const koCount = Object.keys(payload.knockoutPredictions ?? {}).length;
    if (koCount > 0) withKnockouts++;
    if (samples.length < 5) {
      samples.push({
        bracketId: row.id,
        userId: row.user_id,
        tournament: row.tournament_id,
        oldVersion: v,
        matchPredictions: Object.keys(payload.matchPredictions ?? {}).length,
        knockoutPredictions: koCount,
      });
    }
    if (!APPLY) continue;
    const next = {
      ...payload,
      bestThirds: [],
      knockoutPredictions: {},
      version: 3,
    };
    updateStmt.run(JSON.stringify(next), row.id);
  }
});

tx();

console.error(`Scanned ${rows.length} brackets.`);
console.error(`  v<3 candidates: ${candidates}`);
console.error(`  with knockout picks that will be cleared: ${withKnockouts}`);
console.error(`  unparseable rows: ${parseFailures}`);
if (samples.length) {
  console.error("Sample:");
  for (const s of samples) console.error(`  ${JSON.stringify(s)}`);
}
if (APPLY) {
  console.error(`✓ Wrote ${candidates} bracket migrations.`);
} else {
  console.error("Dry-run complete. Re-run with --apply to write changes.");
}
db.close();
