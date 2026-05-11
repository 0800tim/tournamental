-- 0003_syndicates.sql — syndicate signup + GHL retry queue.
--
-- The `syndicate_members` table from 0001_init.sql is membership-only
-- (user_id, syndicate_id, joined_at). It exists for the leaderboard
-- inner-join and predates the signup funnel.
--
-- This migration adds:
--   - `syndicates` — the metadata row created by the public signup
--     route at `apps/web/app/api/v1/syndicates`. One row per pool.
--   - `syndicate_owners_membership` — a richer membership table that
--     also tracks role (owner | member). We keep `syndicate_members`
--     in place so existing leaderboard queries keep working, and
--     write to both during the migration window. Post-launch we'll
--     consolidate by extending `syndicate_members` with a `role`
--     column.
--   - `syndicates_pending_ghl` — a dead-letter queue for the GoHigh-
--     Level CRM push. Rows here are retried by a daily cron (out of
--     scope of this migration); on success the row is deleted.

CREATE TABLE IF NOT EXISTS syndicates (
  id                  TEXT PRIMARY KEY,             -- uuid v4
  slug                TEXT UNIQUE NOT NULL,         -- /s/<slug>
  name                TEXT NOT NULL,
  tournament_id       TEXT NOT NULL,
  owner_email         TEXT NOT NULL,
  owner_phone         TEXT NOT NULL,
  owner_user_id       TEXT,                          -- Supabase user id when known
  owner_handle        TEXT,
  size_band           TEXT NOT NULL,                 -- '2-10' | '11-30' | '31-100' | '100-plus'
  topic               TEXT,
  marketing_consent   INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,              -- epoch ms
  member_count        INTEGER NOT NULL DEFAULT 1,
  share_guid          TEXT NOT NULL UNIQUE           -- 16-char nanoid-ish
);

CREATE INDEX IF NOT EXISTS idx_syndicates_slug
  ON syndicates(slug);
CREATE INDEX IF NOT EXISTS idx_syndicates_share_guid
  ON syndicates(share_guid);
CREATE INDEX IF NOT EXISTS idx_syndicates_tournament
  ON syndicates(tournament_id, created_at DESC);

-- Owner-and-member membership table with role. New writes go here;
-- the legacy `syndicate_members` continues to receive a row for the
-- same (user_id, syndicate_id) pair so the leaderboard inner-join
-- keeps working without a schema change to the existing code path.
CREATE TABLE IF NOT EXISTS syndicate_owners_membership (
  syndicate_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',       -- 'owner' | 'member'
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (syndicate_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_syndicate_owners_membership_user
  ON syndicate_owners_membership(user_id);

CREATE TABLE IF NOT EXISTS syndicates_pending_ghl (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  syndicate_id    TEXT NOT NULL,
  payload_json    TEXT NOT NULL,                     -- the GHL contact body
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_ghl_next_attempt
  ON syndicates_pending_ghl(next_attempt_at);
