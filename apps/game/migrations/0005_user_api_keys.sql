-- 0005_user_api_keys.sql , self-service personal API keys.
--
-- Why: contributors landing on tournamental.com/engineering and the
-- build-on-Tournamental walkthrough need a way to authenticate writes
-- against the REST API and the MCP server without a Supabase session
-- token. The /profile/api-keys page mints keys against this table.
--
-- Security:
--   * `key_hash` stores a salted scrypt hash of the plaintext key. The
--     plaintext is shown ONCE in the mint response and never persisted.
--   * `key_prefix` is the visible 16-char prefix ("tnm_live_aBcDeFgH")
--     and is used to narrow the lookup before the constant-time hash
--     compare , no plaintext key ever ends up in a log line.
--   * `revoked_at` flips a key to dead but keeps the row so the audit
--     trail (last_used_at, label, scopes) is preserved.
--
-- Idempotency: this file is recorded in _migrations after a clean apply
-- so re-running the service is a no-op.

CREATE TABLE IF NOT EXISTS user_api_keys (
  id              TEXT PRIMARY KEY,                -- nanoid, public-facing
  user_id         TEXT NOT NULL,                   -- Supabase auth user id
  label           TEXT NOT NULL,                   -- user-supplied name
  key_prefix      TEXT NOT NULL,                   -- "tnm_live_" + first 8 chars of plaintext base62
  key_hash        TEXT NOT NULL,                   -- scrypt hash of the plaintext
  scopes          TEXT NOT NULL DEFAULT '[]',      -- JSON array of scope strings
  rate_limit_rpm  INTEGER NOT NULL DEFAULT 600,    -- per-key requests-per-minute (user tier default)
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  revoked_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user
  ON user_api_keys(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_api_keys_prefix
  ON user_api_keys(key_prefix);
