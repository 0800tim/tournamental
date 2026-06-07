-- 0013_bot_arena.sql , Open Bot Arena schema (Phase 1 + Phase 2 hooks).
--
-- Phase 1 ships the FIFA WC 2026 launch on 11 June 2026: ~18k seeded
-- bot users, external bot operators via the bot SDK, and a leaderboard
-- that splits humans vs bots. Phase 2 (post-launch, in-tournament)
-- onboards federated node operators who run their own swarms and
-- report aggregates back to the central tier.
--
-- Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md
--
-- New columns:
--   * users.is_bot              , mirror of apps/auth-sms users.is_bot
--                                 so the leaderboard scope filter can
--                                 join cheaply (§5.2).
--   * brackets.committed_at_utc , Phase 2 forward-compat audit hook
--                                 per §15.6 , every kickoff OTS
--                                 commitment stamps the picks it
--                                 anchored so federated nodes can
--                                 reconstruct which picks landed in
--                                 which on-chain commit later.
--
-- New tables:
--   * bot_owner                 , ties a bot user to the API key that
--                                 issued it (§7.2 ownership check).
--   * api_key                   , per-developer API key hashes +
--                                 quotas (§6.3, §8.1).
--   * quota_window              , sliding hourly pick-quota ledger
--                                 (§6.4).
--   * federated_node            , Phase 2 node registry (§15.2 init).
--   * federated_leaderboard_snapshot
--                               , Phase 2 post-match aggregate
--                                 report (§15.2 outcome flow).

-- ---------------------------------------------------------------
-- Phase 1: bot identity + ownership + quota
-- ---------------------------------------------------------------

ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users(is_bot);

ALTER TABLE brackets ADD COLUMN committed_at_utc INTEGER;
CREATE INDEX IF NOT EXISTS idx_brackets_committed_at
  ON brackets(committed_at_utc);

CREATE TABLE IF NOT EXISTS bot_owner (
  bot_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_email         TEXT NOT NULL,
  owner_api_key_hash  TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_owner_email ON bot_owner(owner_email);
CREATE INDEX IF NOT EXISTS idx_bot_owner_key   ON bot_owner(owner_api_key_hash);

CREATE TABLE IF NOT EXISTS api_key (
  key_hash              TEXT PRIMARY KEY,
  owner_email           TEXT NOT NULL,
  label                 TEXT,
  quota_bots            INTEGER NOT NULL DEFAULT 1000,
  quota_picks_per_hour  INTEGER NOT NULL DEFAULT 100000,
  created_at            INTEGER NOT NULL,
  revoked_at            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_key_owner ON api_key(owner_email);

-- Sliding-hour quota ledger. window_start = floor(now_ms / 3600000) * 3600000.
CREATE TABLE IF NOT EXISTS quota_window (
  api_key_hash  TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  picks_used    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_hash, window_start)
);

-- ---------------------------------------------------------------
-- Phase 2 hooks: federated node registry + aggregate snapshots
-- ---------------------------------------------------------------

-- One row per registered external node operator. owner_api_key_hash
-- is the sha256 of the credential issued at registration time and is
-- used to authenticate POST /v1/nodes/commit and /v1/nodes/leaderboard
-- without inventing a second auth scheme.
CREATE TABLE IF NOT EXISTS federated_node (
  node_id              TEXT PRIMARY KEY,
  owner_email          TEXT NOT NULL,
  owner_api_key_hash   TEXT NOT NULL,
  public_url           TEXT NOT NULL,
  label                TEXT,
  registered_at        INTEGER NOT NULL,
  last_seen_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_federated_node_owner
  ON federated_node(owner_email);
CREATE INDEX IF NOT EXISTS idx_federated_node_key
  ON federated_node(owner_api_key_hash);

-- Per-match aggregate report published by a federated node. The
-- merkle_root and bot_count land pre-kickoff via /v1/nodes/commit;
-- the leaderboard fields land post-match via /v1/nodes/leaderboard.
-- We use ONE table for both because the (node_id, match_id) pair is
-- the natural primary key and the lifecycle (commit, then score) is
-- a single logical row.
CREATE TABLE IF NOT EXISTS federated_leaderboard_snapshot (
  node_id              TEXT NOT NULL REFERENCES federated_node(node_id) ON DELETE CASCADE,
  match_id             TEXT NOT NULL,
  merkle_root          TEXT,
  kickoff_at           INTEGER,
  total_bots           INTEGER,
  bots_correct         INTEGER,
  bots_still_perfect   INTEGER,
  top_json_blob        TEXT,
  submitted_at         INTEGER NOT NULL,
  PRIMARY KEY (node_id, match_id)
);
CREATE INDEX IF NOT EXISTS idx_fed_snapshot_match
  ON federated_leaderboard_snapshot(match_id);
