-- 0001_init.sql — initial schema for the Tournamental game service (docs/12).
--
-- Why SQLite: docs/12 specifies "no SQL — flat files + KV" for the
-- production gamification layer. This service is the *write authority*
-- between the bot/web and the snapshotter. SQLite is a single-process
-- replacement for the Redis hot KV until we wire that up; it's durable,
-- transactional, and trivial to back up.
--
-- Schema is intentionally minimal. We persist the *raw* bracket payload
-- as JSON so the scoring engine can be re-run any time without a
-- migration.

-- Pragmas are set on every connection in `apps/game/src/store/db.ts`
-- (journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON). We deliberately
-- don't repeat them here because better-sqlite3 forbids SAFETY-level
-- pragmas inside a transaction, and migrations run wrapped in
-- BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL  -- epoch ms
);

CREATE TABLE IF NOT EXISTS brackets (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  tournament_id   TEXT NOT NULL,
  payload_json    TEXT NOT NULL,       -- the full Bracket from @vtorn/bracket-engine
  locked_at       INTEGER NOT NULL,    -- epoch ms
  score_total     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, tournament_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brackets_tournament_score
  ON brackets(tournament_id, score_total DESC);

CREATE TABLE IF NOT EXISTS match_results (
  match_id        TEXT NOT NULL,
  tournament_id   TEXT NOT NULL,
  outcome         TEXT NOT NULL,       -- JSON: { outcome, homeScore?, awayScore?, winner? }
  recorded_at     INTEGER NOT NULL,
  PRIMARY KEY (match_id, tournament_id)
);

CREATE INDEX IF NOT EXISTS idx_match_results_tournament
  ON match_results(tournament_id);

CREATE TABLE IF NOT EXISTS syndicate_members (
  user_id      TEXT NOT NULL,
  syndicate_id TEXT NOT NULL,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, syndicate_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_syndicate_members_syndicate
  ON syndicate_members(syndicate_id);
