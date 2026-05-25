-- 0009_syndicate_join_terms.sql
--
-- Admin-authored terms & payment instructions for the pool join flow.
-- Shown to joiners on /s/<slug>/join when a pool has an entry fee
-- (Tournamental never handles the money; the admin collects it and sets
-- the terms here). Free-form text, nullable.

ALTER TABLE syndicates ADD COLUMN join_fee_terms_text TEXT;
