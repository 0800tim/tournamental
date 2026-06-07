-- 0005-add-is-bot.sql , Bot Arena marker on the user table.
--
-- Why: the Phase 1 Open Bot Arena (see
-- docs/superpowers/specs/2026-06-07-bot-arena-design.md §4.1) needs to
-- distinguish bots from humans at the auth layer so the prize-eligibility
-- gate and the leaderboard scope filter can short-circuit on a single
-- column read. Default 0 backfills existing rows safely.
--
-- Note: auth-sms applies migrations inline via Storage.migrate*() helpers
-- rather than reading these .sql files at runtime. This file is the
-- canonical reference for the migration. The runtime equivalent lives in
-- apps/auth-sms/src/storage.ts inside migrateUserBotColumn().

ALTER TABLE user ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_user_is_bot ON user(is_bot);
