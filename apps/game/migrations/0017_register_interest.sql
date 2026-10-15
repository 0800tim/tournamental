-- Register-interest signups for upcoming tournaments (first use: Rugby
-- World Cup 2027 on the play.tournamental.com hub, 2026-10-16).
--
-- Written by apps/web (lib/register-interest/store.ts) with the same
-- idempotent DDL, so the web app can take signups before the game
-- service has restarted to apply this file. Keep the two in sync.
--
-- One row per (tournament_id, email). invite_code is the person's
-- personal referral code (play.tournamental.com/i/<code>);
-- referred_by_code records who invited them. HighLevel sync status is
-- tracked here so failures can be retried from the local row.

CREATE TABLE IF NOT EXISTS register_interest (
  id               TEXT PRIMARY KEY,              -- nanoid 'ri_<...>'
  tournament_id    TEXT NOT NULL,                  -- e.g. 'rwc-2027'
  email            TEXT NOT NULL,                  -- lower-cased, trimmed
  first_name       TEXT,
  country          TEXT,                           -- ISO 3166-1 alpha-2
  phone            TEXT,                           -- E.164 when given
  consent          INTEGER NOT NULL DEFAULT 0,     -- marketing consent tick
  source_host      TEXT,                           -- host the form was on
  source_path      TEXT,
  referred_by_code TEXT,                           -- inviter's invite_code
  invite_code      TEXT NOT NULL UNIQUE,           -- this person's code
  ip_hash          TEXT,                           -- sha256(ip + salt), abuse checks only
  user_agent       TEXT,
  ghl_status       TEXT NOT NULL DEFAULT 'queued', -- queued | synced | failed | skipped
  ghl_contact_id   TEXT,
  ghl_error        TEXT,
  ghl_attempts     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,               -- epoch ms
  updated_at       INTEGER NOT NULL,
  UNIQUE (tournament_id, email)
);

CREATE INDEX IF NOT EXISTS idx_register_interest_tournament_created
  ON register_interest(tournament_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_register_interest_referred_by
  ON register_interest(referred_by_code);
CREATE INDEX IF NOT EXISTS idx_register_interest_ghl
  ON register_interest(ghl_status, updated_at);
