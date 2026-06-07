-- 0011_correct_picks.sql — leaderboard X = number of correctly predicted
-- match outcomes (Tim 2026-06-07).
--
-- `score_total` keeps its current semantic — multiplier-weighted points
-- per docs/16 — for backwards compat with the existing leaderboard tests
-- and any analytics that read it. The new `correct_picks` is the simple
-- "1 per correct match" count Tim's spec (mock/leaderboard.ts) has
-- always documented as the live game's contract. The web leaderboard
-- renders `X / Y` as `correct_picks / matches_available_to_user` so the
-- numerator and denominator are the same kind of integer.
--
-- Updated by the match-result POST hook alongside score_total. Backfills
-- to 0 for every pre-existing row; the next result POST recomputes and
-- writes the correct value.

ALTER TABLE brackets
  ADD COLUMN correct_picks INTEGER NOT NULL DEFAULT 0;

-- Compound index so the leaderboard's ORDER BY clause stays an index
-- scan: correct_picks DESC, locked_at ASC, user_id ASC.
CREATE INDEX IF NOT EXISTS idx_brackets_tournament_correct
  ON brackets(tournament_id, correct_picks DESC, locked_at ASC, user_id ASC);
