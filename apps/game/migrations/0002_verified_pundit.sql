-- 0002_verified_pundit.sql — adds tournament-settle markers and the
-- "Verified Pundit" derived table.
--
-- Background: a user is a "Verified Pundit" when they finished in the top
-- 100 of any *settled* tournament's overall leaderboard. Multi-tournament
-- pundits accumulate `levels` (one per qualifying tournament).
--
-- The qualifier rule is intentionally simple for v0.1 — see PR body for
-- the planned evolution (rolling 12-month window, Humanness-Score-weighted,
-- tournament-difficulty-weighted, etc.). This table is the persisted
-- output of a deterministic compute that re-runs on boot and on every
-- tournament-settle event.
--
-- We keep the raw qualifier rows in `verified_pundit_records` (one row
-- per (user_id, tournament_id) qualification) so the API can show *which*
-- tournaments earned a user the badge. The roll-up `levels` count and
-- earliest `since_date` are derived per-read from the records table to
-- avoid keeping two sources of truth.

CREATE TABLE IF NOT EXISTS tournaments (
  id           TEXT PRIMARY KEY,
  -- Display name used by clients that don't carry tournament fixtures
  -- locally (e.g. the admin Customer-360 panel). Optional.
  name         TEXT,
  settled_at   INTEGER,           -- epoch ms; NULL = still in-flight
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tournaments_settled
  ON tournaments(settled_at);

CREATE TABLE IF NOT EXISTS verified_pundit_records (
  user_id        TEXT NOT NULL,
  tournament_id  TEXT NOT NULL,
  -- Final rank achieved on the global leaderboard (1..100).
  final_rank     INTEGER NOT NULL,
  -- Total score that earned the qualification — denormalised for audit.
  score_total    INTEGER NOT NULL,
  -- When this qualification was stamped (compute run time).
  stamped_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, tournament_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pundit_user
  ON verified_pundit_records(user_id);

CREATE INDEX IF NOT EXISTS idx_pundit_tournament
  ON verified_pundit_records(tournament_id);
