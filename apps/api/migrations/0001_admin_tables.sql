-- 0001_admin_tables.sql
--
-- Admin-side schema for the Tournamental admin console (apps/admin).
-- Adds three tables:
--   - admin_users         (allowlist mirror, role assignment, last-seen)
--   - admin_audit_log     (append-only log of every state-changing action)
--   - admin_feature_flags (typed flag store; replaces ad-hoc env toggles)
--
-- The admin allowlist is *also* enforced at the app layer via the
-- ADMIN_EMAILS env var; this table is the persistent record so audit
-- queries can join actor email -> role at action time even after env
-- reshuffles.
--
-- Migrations are plain SQL per `apps/<service>/migrations/` convention
-- (see CLAUDE.md "Database and cache stack"). Run via the API's normal
-- migration runner.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  role           TEXT NOT NULL CHECK (role IN ('super-admin','mod','viewer')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ,
  disabled_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users (lower(email));

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_email    TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  action         TEXT NOT NULL,
  target         TEXT,
  reason         TEXT,
  before         JSONB,
  after          JSONB,
  ip_hashed      BYTEA,
  ua_hash        BYTEA
);

CREATE INDEX IF NOT EXISTS admin_audit_ts_idx     ON admin_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx  ON admin_audit_log (actor_email, ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_log (action, ts DESC);

CREATE TABLE IF NOT EXISTS admin_feature_flags (
  key             TEXT PRIMARY KEY,
  description     TEXT NOT NULL DEFAULT '',
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  geo_overrides   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT
);

COMMIT;
