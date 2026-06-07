-- 0016_swarm_claims_user.sql — bind every swarm_claim to a signed-in
-- user_id so the public bot count only includes owned bots.
--
-- Background (Tim 2026-06-08): /v1/swarm/commit previously accepted
-- anonymous browser submissions (node_id="browser-..."), which let an
-- incognito tab spawn 100K bots that landed in the public counter
-- with no owner and no way to authenticate the operator. The new
-- flow requires a tnm_session cookie on the commit, resolves it
-- through resolveUserId, and stores the resulting user_id alongside
-- the row.
--
-- The column is nullable for backward compatibility with any in-flight
-- claim row written by the bot-node Docker container (which uses a
-- different /v1/swarms/<operator_id>/summary path and is unaffected
-- by this change). The browser-swarm /commit handler will refuse to
-- insert a row with null user_id from this migration forward.
--
-- The /v1/swarm/totals aggregator filters `WHERE user_id IS NOT NULL`
-- so the legacy null-user rows (if any survive the wipe) don't show
-- up on the public counter either.

ALTER TABLE swarm_claims ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_swarm_claims_user_id
  ON swarm_claims(user_id);

-- Defensive wipe: every row currently in swarm_claims pre-dates the
-- ownership requirement and is therefore unowned by construction. The
-- bot-node Docker container's data lives in `swarm_summary`, which is
-- untouched. Operators upgrading get a clean baseline for the public
-- counter.
DELETE FROM swarm_claims;
