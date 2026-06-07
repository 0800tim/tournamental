-- 0014_swarm_claims.sql — browser-swarm federation + OTS proof storage.
--
-- One row per (node_id, run_id) swarm-summary submission. The browser
-- swarm POSTs to /v1/swarm/commit when a run finishes; this table is
-- the durable home of the resulting record. We keep this separate from
-- federated_leaderboard_snapshot (which is per (node_id, match_id))
-- because a single browser run produces ONE summary covering all
-- matches, and its merkle_root is the single thing that gets OTS-
-- timestamped.
--
-- Lifecycle:
--   1. POST /v1/swarm/commit lands a row with `ots_status='pending'`
--      and `pending_calendar_blobs` populated for the calendars that
--      ack'd within the request window (≥3 of 4 to count as success).
--   2. The OTS scheduler periodically polls the calendars for upgrade
--      and rewrites `upgraded_ots_bytes` + `ots_status` to 'confirmed'
--      once a Bitcoin attestation lands.
--   3. GET /v1/swarm/leaderboard ranks rows by claimed_score and
--      includes the proof URL.
--   4. GET /v1/swarm/proof/<merkle_root> serves the upgraded .ots
--      file (or the pending one as a fallback).
--
-- Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6

CREATE TABLE IF NOT EXISTS swarm_claims (
  -- Composite key: a single node may submit many runs, but the same
  -- (node_id, run_id) is idempotent.
  node_id              TEXT NOT NULL,
  run_id               TEXT NOT NULL,
  -- Master seed used by the browser swarm to regenerate every bot's
  -- bracket. Stored so the /verify route can replay any bot_index
  -- locally without needing to trust the submitter.
  master_seed          TEXT NOT NULL,
  strategy             TEXT NOT NULL DEFAULT 'chalk-v1',
  total_bots           INTEGER NOT NULL,
  -- Merkle root over all bots' picks. 64-char lower-hex sha256.
  merkle_root          TEXT NOT NULL,
  -- Single best-score row the swarm is willing to attest to. Encoded
  -- as JSON so the leaderboard route can render it without a schema
  -- change every time the bot-arena scoring tweaks land.
  -- Shape: { bot_index: number, claimed_score: number, picks_count: number }
  top_n_claim_json     TEXT NOT NULL,
  claimed_score        REAL NOT NULL DEFAULT 0,
  started_at           INTEGER NOT NULL,
  finished_at          INTEGER NOT NULL,
  submitted_at         INTEGER NOT NULL,
  -- OTS proof state machine: pending | confirmed | failed.
  ots_status           TEXT NOT NULL DEFAULT 'pending',
  -- JSON array of { calendar_url, pending_bytes_hex, submitted_at }
  -- for every calendar that ack'd the submission. Populated at commit
  -- time; immutable thereafter.
  pending_calendar_blobs TEXT NOT NULL DEFAULT '[]',
  -- Hex bytes of an UPGRADED OTS proof (with Bitcoin attestation),
  -- once the scheduler finds one. Null while still pending.
  upgraded_ots_hex     TEXT,
  upgraded_calendar_url TEXT,
  upgraded_at          INTEGER,
  -- Last time the upgrade scheduler tried this row. NULL while
  -- nothing has tried.
  last_upgrade_attempt_at INTEGER,

  PRIMARY KEY (node_id, run_id)
);

-- Cross-swarm ranking comes from a single column scan; the index keeps
-- the leaderboard top-100 read under 5ms even at 100k rows.
CREATE INDEX IF NOT EXISTS idx_swarm_claims_score
  ON swarm_claims(claimed_score DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_claims_merkle_root
  ON swarm_claims(merkle_root);

CREATE INDEX IF NOT EXISTS idx_swarm_claims_status
  ON swarm_claims(ots_status, last_upgrade_attempt_at);
