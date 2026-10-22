# 2026-10-21 tournamental-agent: best thirds sized and ordered by the tournament

**Branch**: `feat/web-thirds-by-rules`, stacked on `feat/rwc-2027-fixtures` (PR #369), worktree, draft PR.
**Refs**: docs/design/rwc2027-engine-readiness.md (gap 6, second half), PR #366 (`compareStandingsAcrossGroups`)

## Plan

The engine ranks third-placed teams by the tournament's rules since
#366, but apps/web still hard-coded FIFA 2026: eight of twelve thirds,
ranked by FIFA rank (picker, consensus, swarm) or by goals with a
team-code fallback (official results). Add one helper that reads the
count from `advancement.wildcard_third` and the order from the engine
comparator, and route every consumer through it.

## Decisions

- `rankThirds` = engine comparator (points, then the thirds chain),
  then world ranking, then team code. World ranking stands in for the
  unmodelled disciplinary and drawing-of-lots steps; for predictions
  without score lines this gives "points, then world rank", which is
  better than world rank alone.
- Checked against the real 2026 archive results (read-only query of
  game.db): the eight best thirds are identical under the new order,
  so the archive bracket does not change.
- `teamWorldRank` reads `world_rank` before `fifa_rank`; the wider
  `fifa_rank` rename stays parked.
- The picker copy, badges and listbox label now come from the
  tournament (count, groups, ranking authority, entry round).
  `autoPickTop8Thirds` (unused) became `autoPickBestThirds`.
- The results path leaves `best_thirds` undefined for formats that
  advance no thirds.

## Outcome

New `apps/web/lib/bracket/thirds.ts`; `real-standings.ts`,
`odds-consensus.ts`, `ThirdsPicker.tsx`, `BracketBuilder.tsx`
(progress total) and `browser-swarm/cascade.ts` use it. Three new test
files (helper, RWC 2027 results path, picker) and two existing tests
updated for the new fallback order. 41 tests pass across the seven
affected files; `tsc` clean; eslint clean on the changed files.

## Second commit

`CascadeWarnings` takes an optional `tournament` and sizes the
best-thirds messages from it ("all 4 picks before the Round of 16");
the 2026 wording is the fallback when none is passed. The builder's
three call sites pass it. Three tests; bracket-tabs suite still green.

## Next steps

- Needs Tim: nothing beyond merging #366, #369 and this in order.

## Review (2026-10-22)

Independent review, all findings actioned in the third commit.
Medium: the thirds panel heading and aria-label still said "Top 8";
now "Best 3rd Place" and sized from the tournament. Medium: the
results path ranked rugby thirds by tries but no try counts reached
the engine; `RecordedResultLite`, the persistence row, the archive
builder, the results API body and the builder's `ResultedMatch` now
carry `homeTries`/`awayTries` (the game stores them on #374), with a
test where a try bonus changes the four. Low: the unused
`WINNER_TRIES` is gone; the readiness doc no longer claims the swarm
goes through the helper (it keeps rank-only order for bots, by
design, and reads `world_rank` first); the explainer lists the chain
with "and" and only mentions discipline and lots for football;
`CascadeWarnings` requires the tournament and the 2026 fallback is
gone; stale "8" comments fixed; the picker ordering test now uses a
drawn pool match so predicted points beat world rank. Notes: a
comment on the 99 versus negative-infinity rank fallback; rugby
league gets its own ranking label.
