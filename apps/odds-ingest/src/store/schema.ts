/**
 * SQLite schema embedded as a TS string. Kept in sync with schema.sql so the
 * sql file is the human-readable canonical source and this file is what the
 * runtime executes (avoids ship-time path resolution for files outside the
 * tsc rootDir).
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS odds_market (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_id       TEXT,
  match_id        TEXT,
  kind            TEXT NOT NULL,
  question        TEXT NOT NULL,
  outcomes_json   TEXT NOT NULL,
  starts_at       INTEGER,
  ends_at         INTEGER,
  resolved        INTEGER NOT NULL DEFAULT 0,
  resolved_outcome TEXT,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_match ON odds_market(match_id, kind);
CREATE INDEX IF NOT EXISTS idx_market_source ON odds_market(source, source_id);
CREATE INDEX IF NOT EXISTS idx_market_kind ON odds_market(kind);

CREATE TABLE IF NOT EXISTS odds_tick (
  market_id     TEXT NOT NULL REFERENCES odds_market(id) ON DELETE CASCADE,
  outcome_label TEXT NOT NULL,
  best_bid      REAL,
  best_ask      REAL,
  last          REAL,
  implied_prob  REAL,
  volume_24h    REAL,
  ts            INTEGER NOT NULL,
  PRIMARY KEY (market_id, outcome_label, ts)
);

CREATE INDEX IF NOT EXISTS idx_tick_recent ON odds_tick(market_id, ts DESC);
`;
