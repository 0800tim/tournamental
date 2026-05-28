-- 0010_invite_jobs.sql
--
-- Bulk invite queue for pool owners (and Tournamental admins) to send
-- WhatsApp + email warm-invites to a CSV of contacts. The warm-invite
-- URL embeds firstname/email/mobile query-string params so the
-- recipient's tap kicks off OTP automatically (see apps/web join flow).
--
-- Two tables:
--   - invite_jobs: one row per bulk submission. Tracks the composer
--     body, the throttle, totals, and the lifecycle status.
--   - invite_recipients: one row per CSV line. The runner drains
--     queued recipients at the job's throttle rate, calls auth-sms
--     /v1/internal/send-message, and writes per-channel status back.
--
-- Permission gating happens at the API layer; this schema is purely
-- a job queue.

CREATE TABLE IF NOT EXISTS invite_jobs (
  id              TEXT PRIMARY KEY,        -- nanoid
  syndicate_id    TEXT NOT NULL,
  syndicate_slug  TEXT NOT NULL,           -- denormalised for the URL builder
  created_by      TEXT NOT NULL,           -- user_id of the operator
  created_by_kind TEXT NOT NULL,           -- 'owner' | 'admin'
  channels        TEXT NOT NULL DEFAULT '["whatsapp","email"]',  -- JSON array
  message_body    TEXT NOT NULL,           -- plain text, <= 1000 chars
  throttle_ms     INTEGER NOT NULL DEFAULT 1000,
  status          TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'running' | 'paused' | 'done' | 'cancelled'
  total           INTEGER NOT NULL DEFAULT 0,
  sent            INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  skipped         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  completed_at    INTEGER,
  -- A free-form `notes` column so future fields don't need migrations.
  notes_json      TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_invite_jobs_syndicate
  ON invite_jobs(syndicate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invite_jobs_status
  ON invite_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS invite_recipients (
  id              TEXT PRIMARY KEY,         -- nanoid
  job_id          TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT,
  phone_e164      TEXT,
  warm_url        TEXT NOT NULL,
  -- 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'
  status          TEXT NOT NULL DEFAULT 'queued',
  -- Per-channel results JSON: { whatsapp?: {status,error}, email?: {...} }
  channel_result_json TEXT NOT NULL DEFAULT '{}',
  -- Sequence inside the job to preserve CSV order on retry.
  seq             INTEGER NOT NULL DEFAULT 0,
  queued_at       INTEGER NOT NULL,
  sent_at         INTEGER,
  error           TEXT,
  FOREIGN KEY (job_id) REFERENCES invite_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invite_recipients_job
  ON invite_recipients(job_id, status, seq);

-- The runner uses this index to claim the next message across all
-- active jobs in a single query.
CREATE INDEX IF NOT EXISTS idx_invite_recipients_drain
  ON invite_recipients(status, queued_at);
