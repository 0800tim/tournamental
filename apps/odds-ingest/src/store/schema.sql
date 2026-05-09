-- odds-ingest SQLite schema.
-- Designed to mirror the Postgres schema in docs/29 closely enough that a future
-- migration is mechanical (s/numeric/REAL/, s/timestamptz/INTEGER (unix ms)/).

CREATE TABLE IF NOT EXISTS odds_market (
  id              TEXT PRIMARY KEY,           -- internal: "wc2026:match:CRO_BRA" or "wc2026:winner:ARG"
  source          TEXT NOT NULL,              -- 'polymarket' | 'theoddsapi' | 'mock'
  source_id       TEXT,                       -- Polymarket condition_id, Odds API event_id, etc
  match_id        TEXT,                       -- match_number from fixtures.json (string for joins) — NULL for tournament/group winners
  kind            TEXT NOT NULL,              -- 'match_moneyline' | 'tournament_winner' | 'group_winner' | 'top_scorer'
  question        TEXT NOT NULL,
  outcomes_json   TEXT NOT NULL,              -- JSON: [{label, our_team_code|null, our_player_id|null, source_token_id|null}]
  starts_at       INTEGER,                    -- unix ms
  ends_at         INTEGER,
  resolved        INTEGER NOT NULL DEFAULT 0, -- 0/1
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
  implied_prob  REAL,                         -- canonical 0..1 probability we expose
  volume_24h    REAL,
  ts            INTEGER NOT NULL,             -- unix ms
  PRIMARY KEY (market_id, outcome_label, ts)
);

CREATE INDEX IF NOT EXISTS idx_tick_recent ON odds_tick(market_id, ts DESC);
