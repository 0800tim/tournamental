-- 0003_users_profiles.sql — user registration + rich progressive profile.
--
-- The v0.1 `users` table (migration 0001) carried only an id + created_at.
-- That was enough for the dev-mesh trust model where the X-User-Id header
-- *was* the user. Tim's 2026-05-11 ask is the next step: a handle, an
-- auth method, and a rich profile that fills in over time.
--
-- Design choices documented here so future contributors don't have to dig:
--
-- - Handle is the public identifier (`@tim_w`). Stored in `users` not the
--   profile table because it's part of identity / addressing, not optional
--   demographic data. UNIQUE so we can do `/u/<handle>` routes cleanly.
-- - `auth_method` + `auth_id` are intentionally loose strings: telegram /
--   sms / email-magic-link / guest. The pair is indexed so a Telegram bot
--   webhook can resolve `(telegram, 12345678)` to a user in one lookup.
--   Real Telegram-JWT verification comes in `docs/13`; this is the
--   dev/staging surface.
-- - `deleted_at` is GDPR soft-delete. We null PII in `user_profiles` in
--   the DELETE handler (transactionally) but leave the `users` row so
--   foreign keys (brackets, syndicates, pundit records) keep referential
--   integrity. A nightly cleanup job (TODO doc/32) can hard-delete rows
--   older than 30 days.
-- - We bucket age instead of storing raw birthdates. Tim asked for "age",
--   `age_bucket` is the privacy-respecting equivalent: less precise, far
--   less risky in a breach, still usable for segmentation. Same logic for
--   `country_code` (ISO-2) rather than lat/lon.
-- - `engagement_band` is computed in app code on each visit. We considered
--   a SQLite trigger but SQLite triggers are gnarly and we want the
--   computation to be testable + auditable.
-- - `user_profile_history` is append-only: every profile change writes a
--   row. Two consumers: the user (we surface their own edit history in
--   the profile page later) and GDPR (the data-export endpoint dumps
--   this table verbatim).

-- ---- users: extend with identity columns -------------------------------
--
-- The original `users` table from 0001 had only (id, created_at). SQLite
-- allows ADD COLUMN but not modifying defaults retroactively, so we
-- backfill `last_seen_at` from `created_at` in a follow-up UPDATE.

ALTER TABLE users ADD COLUMN handle        TEXT;
ALTER TABLE users ADD COLUMN display_name  TEXT;
ALTER TABLE users ADD COLUMN last_seen_at  INTEGER;
ALTER TABLE users ADD COLUMN auth_method   TEXT;
ALTER TABLE users ADD COLUMN auth_id       TEXT;
ALTER TABLE users ADD COLUMN deleted_at    INTEGER;

UPDATE users SET last_seen_at = created_at WHERE last_seen_at IS NULL;

-- UNIQUE index on handle (instead of UNIQUE constraint) so it tolerates
-- the existing NULL handles for pre-existing rows. NULLs do not collide
-- in a SQLite UNIQUE index.
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique ON users(handle);
CREATE INDEX IF NOT EXISTS users_auth ON users(auth_method, auth_id);

-- ---- user_profiles -----------------------------------------------------

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id            TEXT PRIMARY KEY,
  -- demographic
  age_bucket         TEXT,
  gender             TEXT,
  -- location (ISO-2 country, free-text city, IANA timezone)
  country_code       TEXT,
  city               TEXT,
  timezone           TEXT,
  -- football identity
  favourite_team_code TEXT,
  follows_leagues    TEXT,
  watches_via        TEXT,
  -- engagement (server-computed; visit_count is monotonic per distinct day)
  visit_count        INTEGER NOT NULL DEFAULT 0,
  last_visit_date    TEXT,
  engagement_band    TEXT NOT NULL DEFAULT 'cold',
  -- consent
  marketing_consent  INTEGER NOT NULL DEFAULT 0,
  analytics_consent  INTEGER NOT NULL DEFAULT 1,
  -- timestamps
  updated_at         INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_profiles_country ON user_profiles(country_code);
CREATE INDEX IF NOT EXISTS user_profiles_engagement ON user_profiles(engagement_band);

-- ---- user_profile_history ---------------------------------------------

CREATE TABLE IF NOT EXISTS user_profile_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_profile_history_user ON user_profile_history(user_id, changed_at);
