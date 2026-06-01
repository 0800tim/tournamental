-- 0012_bracket_imports.sql
--
-- Bracket-import feature (docs/69-bracket-import.md). Lets a user
-- import their bracket from a rival platform (Telegraph, ESPN, BBC
-- Predictor, FIFA app, or via LLM screenshot extraction) by pasting
-- the public bracket URL into the /import wizard.
--
-- Picks already past kickoff retro-lock + score on commit; picks
-- still upcoming stay editable on Tournamental, that's the pitch.
--
-- Trust model: the four supported source platforms all lock picks
-- at first-match kickoff, so a successful scrape of their public
-- bracket URL is itself the proof-of-lock-in. The bracket-level
-- audit row + the rate limit + the one-import-per-bracket rule
-- guard against abuse. No syndicate-level toggle (a user belongs to
-- multiple pools; one opt-out shouldn't gate the others).

-- Provenance columns on the existing brackets table.
ALTER TABLE brackets ADD COLUMN imported_source TEXT;
ALTER TABLE brackets ADD COLUMN imported_from_url TEXT;
ALTER TABLE brackets ADD COLUMN imported_at INTEGER;

-- Append-only audit log. One row per import attempt (success or
-- failure). Stores the parsed JSON + a hash of the raw HTML so we
-- can investigate disputes without keeping every HTML blob in
-- sqlite (the actual HTML lives on disk at raw_html_path).
CREATE TABLE IF NOT EXISTS bracket_import_audit (
  id              TEXT PRIMARY KEY,             -- nanoid 'ia_<...>'
  user_id         TEXT NOT NULL,                -- auth-sms user id
  bracket_id      TEXT,                          -- null when the import failed before save
  source          TEXT NOT NULL,                 -- 'telegraph' | 'espn' | 'bbc' | 'fifa' | 'screenshot-ai'
  source_url      TEXT NOT NULL,                 -- the public URL the user pasted, or 'screenshot:<filename>'
  fetched_at      INTEGER NOT NULL,              -- epoch ms
  status          TEXT NOT NULL,                 -- 'parsed' | 'partial' | 'failed' | 'committed'
  http_status     INTEGER,                       -- HTTP status from the source fetch (null for screenshot)
  parsed_json     TEXT,                          -- ParseResult shape, JSON-stringified
  raw_html_sha256 TEXT,                          -- hex hash of the source HTML for dispute resolution
  raw_html_path   TEXT,                          -- on-disk path to the cached raw HTML
  error           TEXT                           -- ImportFailureReason on failure rows
);
CREATE INDEX IF NOT EXISTS idx_bracket_import_audit_user
  ON bracket_import_audit(user_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_bracket_import_audit_bracket
  ON bracket_import_audit(bracket_id);
