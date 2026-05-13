-- 0008_syndicate_prize_pool.sql — entry fee + prize-pool splits.
--
-- Tim's brief 2026-05-13: hosts running a real-money pool need to
-- advertise an entry fee and prize splits (e.g. 1st 75% / 2nd 20% /
-- 3rd 5%) plus an optional bonus-prize line. Tournamental never
-- handles the cash; this is informational metadata that renders on
-- the public landing page and the embed widget.
--
-- entry_fee_cents
--   Integer cents in the syndicate's nominal currency (NZD for now).
--   NULL means "no fee, bragging rights only". Stored as cents to
--   avoid floating-point grief; the UI parses dollars in / out.
--
-- entry_fee_currency
--   ISO 4217 code, defaults to NZD. We don't convert; the host
--   advertises in whatever they collect in.
--
-- prize_split_json
--   JSON array of { rank, percent, label?, sponsor_name? }. The UI
--   validates that percent values sum to 100 before save. Storing as
--   JSON keeps the schema simple while letting the host run any prize
--   structure (winner-takes-all → [{rank:1, percent:100}], podium →
--   [{rank:1, percent:75}, {rank:2, percent:20}, {rank:3, percent:5}],
--   tiered, sponsored bundle, etc.).
--
-- bonus_prize_text
--   Free-form copy for "longest streak", "biggest comeback", "best
--   call of the tournament" etc. The host chooses the criterion and
--   adjudicates; Tournamental never decides.

ALTER TABLE syndicates ADD COLUMN entry_fee_cents INTEGER;
ALTER TABLE syndicates ADD COLUMN entry_fee_currency TEXT DEFAULT 'NZD';
ALTER TABLE syndicates ADD COLUMN prize_split_json TEXT;
ALTER TABLE syndicates ADD COLUMN bonus_prize_text TEXT;
