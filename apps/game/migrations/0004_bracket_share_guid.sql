-- 0004_bracket_share_guid.sql — add a public, opaque share guid to brackets.
--
-- Why: the `/s/<guid>` universal share-landing route in apps/web needs a
-- stable, public identifier for a user's bracket so that visiting the
-- copied URL resolves to the SAME bracket the user saved. Previously the
-- web client used the internal `bracketId` (hash of user × tournament ×
-- timestamp) as the URL guid, and the route handler synthesised a fake
-- bracket from a hash of the guid because the backend lookup didn't
-- exist. That meant Tim's copied link opened a different bracket in
-- incognito — a launch-blocking bug.
--
-- Idempotency: the migration runner records applied files in
-- `_migrations` and skips re-application, so re-running this migration
-- is a no-op on a healthy DB. The first run adds the column without
-- a UNIQUE constraint (so the UPDATE backfill can succeed for every
-- existing row), backfills, then creates a UNIQUE index. Avoids
-- "UNIQUE constraint failed" during backfill on a multi-row table.

ALTER TABLE brackets ADD COLUMN share_guid TEXT;

UPDATE brackets
   SET share_guid = lower(hex(randomblob(8)))
 WHERE share_guid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brackets_share_guid
  ON brackets(share_guid);
