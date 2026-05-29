-- 0011_syndicates_country_gate.sql
--
-- Adds an optional country allow-list to each pool so brand-sponsored
-- public pools can restrict prize-eligible entries to specific
-- markets (e.g. a NZ retailer can run a public pool only winnable by
-- NZ-resident phone holders). NULL = open to all, the legacy
-- behaviour. Spec: docs/68-country-gated-pools.md.
--
-- Stored as CSV of bare E.164 dial codes ("64" or "64,61"). One row
-- per pool, ~5 codes max ever, so a denormalised string keeps reads
-- single-row without any new indexes.

ALTER TABLE syndicates ADD COLUMN allowed_phone_countries TEXT;
