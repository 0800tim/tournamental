-- 0001_init.sql
--
-- VStamp service schema. SQLite (better-sqlite3).
--
-- Three tables:
--   - leaves: append-only log of every prediction-receipt leaf hash. One row
--             per receipt issued. Tournament + day_bucket determine which
--             Merkle tree this leaf belongs to.
--   - roots:  one row per (tournament_id, day_bucket) once the tree has been
--             finalised. Stores the signed Merkle root and its signing pubkey
--             for later verification.
--   - keys:   Ed25519 keypairs. Privkey is AES-256-GCM-encrypted at rest with
--             VSTAMP_KEY_PASSPHRASE. Multiple keys allow rotation; only one is
--             active (retired_at IS NULL) at a time.
--
-- Migrations are checked in per CLAUDE.md "Database and cache stack". This
-- file is applied idempotently at boot in src/lib/db.ts.

CREATE TABLE IF NOT EXISTS leaves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  leaf_hash     TEXT    NOT NULL UNIQUE,
  tournament_id TEXT    NOT NULL,
  user_id_hash  TEXT    NOT NULL,
  locked_at     INTEGER NOT NULL,        -- unix milliseconds
  day_bucket    TEXT    NOT NULL         -- e.g. '2026-05-10' (UTC)
);

CREATE INDEX IF NOT EXISTS leaves_tour_day_idx ON leaves (tournament_id, day_bucket, id);
CREATE INDEX IF NOT EXISTS leaves_locked_idx   ON leaves (locked_at);

CREATE TABLE IF NOT EXISTS roots (
  tournament_id TEXT    NOT NULL,
  day_bucket    TEXT    NOT NULL,
  root_hash     TEXT    NOT NULL,
  sig           TEXT    NOT NULL,        -- hex Ed25519 signature over root_hash bytes
  pubkey        TEXT    NOT NULL,        -- hex Ed25519 public key
  finalised_at  INTEGER NOT NULL,        -- unix milliseconds
  leaf_count    INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, day_bucket)
);

CREATE INDEX IF NOT EXISTS roots_finalised_idx ON roots (finalised_at);

CREATE TABLE IF NOT EXISTS keys (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey            TEXT    NOT NULL UNIQUE,
  privkey_encrypted TEXT    NOT NULL,    -- base64(salt|nonce|ciphertext|tag)
  created_at        INTEGER NOT NULL,
  retired_at        INTEGER
);

CREATE INDEX IF NOT EXISTS keys_active_idx ON keys (retired_at);
