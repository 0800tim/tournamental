-- Loaded by Postgres on first init only (when the data dir is empty).
-- Re-running requires a fresh volume.

-- pgcrypto for gen_random_uuid() and HMAC; ubiquitous.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext for case-insensitive emails / handles without LOWER() everywhere.
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_stat_statements for query-performance review (load_extension also requires
-- shared_preload_libraries; the dev compose doesn't enable it by default,
-- but creating the extension is harmless and makes prod-parity explicit).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- btree_gin for composite indexes that mix btree-ish and array/jsonb columns,
-- which we'll need for leaderboard queries.
CREATE EXTENSION IF NOT EXISTS btree_gin;
