/**
 * SQLite storage for the VStamp service.
 *
 * better-sqlite3 is synchronous and fast enough for the issue/finalise/proof
 * cadence we expect. Schema is loaded from migrations/0001_init.sql so the
 * checked-in SQL is the single source of truth (per CLAUDE.md "Database and
 * cache stack").
 */

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LeafRow {
  id: number;
  leaf_hash: string;
  tournament_id: string;
  user_id_hash: string;
  locked_at: number;
  day_bucket: string;
}

export interface RootRow {
  tournament_id: string;
  day_bucket: string;
  root_hash: string;
  sig: string;
  pubkey: string;
  finalised_at: number;
  leaf_count: number;
}

export interface KeyRow {
  id: number;
  pubkey: string;
  privkey_encrypted: string;
  created_at: number;
  retired_at: number | null;
}

export interface VStampDB {
  raw: Database.Database;
  insertLeaf(row: Omit<LeafRow, 'id'>): LeafRow | null; // null if leaf already existed
  getLeavesForBucket(tournamentId: string, dayBucket: string): LeafRow[];
  getLeafByHash(leafHash: string): LeafRow | null;
  getRoot(tournamentId: string, dayBucket: string): RootRow | null;
  getRootContainingLeaf(leafHash: string): RootRow | null;
  insertRoot(row: RootRow): void;
  countLeaves(): number;
  latestRootAt(): number | null;
  insertKey(pubkey: string, privkeyEncrypted: string, createdAt: number): KeyRow;
  getActiveKey(): KeyRow | null;
  close(): void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, '..', '..', 'migrations', '0001_init.sql');

export function openDb(path: string): VStampDB {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  db.exec(sql);

  const stmts = {
    insertLeaf: db.prepare(
      `INSERT OR IGNORE INTO leaves (leaf_hash, tournament_id, user_id_hash, locked_at, day_bucket)
       VALUES (@leaf_hash, @tournament_id, @user_id_hash, @locked_at, @day_bucket)`,
    ),
    getLeafByHash: db.prepare(`SELECT * FROM leaves WHERE leaf_hash = ?`),
    getLeavesForBucket: db.prepare(
      `SELECT * FROM leaves WHERE tournament_id = ? AND day_bucket = ? ORDER BY id ASC`,
    ),
    getRoot: db.prepare(`SELECT * FROM roots WHERE tournament_id = ? AND day_bucket = ?`),
    insertRoot: db.prepare(
      `INSERT INTO roots (tournament_id, day_bucket, root_hash, sig, pubkey, finalised_at, leaf_count)
       VALUES (@tournament_id, @day_bucket, @root_hash, @sig, @pubkey, @finalised_at, @leaf_count)`,
    ),
    countLeaves: db.prepare(`SELECT COUNT(*) as c FROM leaves`),
    latestRootAt: db.prepare(`SELECT MAX(finalised_at) as m FROM roots`),
    rootForLeaf: db.prepare(
      `SELECT r.* FROM roots r
       JOIN leaves l ON l.tournament_id = r.tournament_id AND l.day_bucket = r.day_bucket
       WHERE l.leaf_hash = ?`,
    ),
    insertKey: db.prepare(
      `INSERT INTO keys (pubkey, privkey_encrypted, created_at)
       VALUES (?, ?, ?)`,
    ),
    activeKey: db.prepare(
      `SELECT * FROM keys WHERE retired_at IS NULL ORDER BY id DESC LIMIT 1`,
    ),
  };

  return {
    raw: db,

    insertLeaf(row) {
      const result = stmts.insertLeaf.run(row);
      if (result.changes === 0) {
        return null;
      }
      const id = Number(result.lastInsertRowid);
      return { id, ...row };
    },

    getLeavesForBucket(tournamentId, dayBucket) {
      return stmts.getLeavesForBucket.all(tournamentId, dayBucket) as LeafRow[];
    },

    getLeafByHash(leafHash) {
      const row = stmts.getLeafByHash.get(leafHash) as LeafRow | undefined;
      return row ?? null;
    },

    getRoot(tournamentId, dayBucket) {
      const row = stmts.getRoot.get(tournamentId, dayBucket) as RootRow | undefined;
      return row ?? null;
    },

    getRootContainingLeaf(leafHash) {
      const row = stmts.rootForLeaf.get(leafHash) as RootRow | undefined;
      return row ?? null;
    },

    insertRoot(row) {
      stmts.insertRoot.run(row);
    },

    countLeaves() {
      const r = stmts.countLeaves.get() as { c: number };
      return r.c;
    },

    latestRootAt() {
      const r = stmts.latestRootAt.get() as { m: number | null };
      return r.m;
    },

    insertKey(pubkey, privkeyEncrypted, createdAt) {
      const result = stmts.insertKey.run(pubkey, privkeyEncrypted, createdAt);
      const id = Number(result.lastInsertRowid);
      return { id, pubkey, privkey_encrypted: privkeyEncrypted, created_at: createdAt, retired_at: null };
    },

    getActiveKey() {
      const r = stmts.activeKey.get() as KeyRow | undefined;
      return r ?? null;
    },

    close() {
      db.close();
    },
  };
}
