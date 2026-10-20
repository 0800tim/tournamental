# 2026-10-20, molecule consensus bracket: best thirds

**Task**: burn round 7, the Polymarket consensus toggle on the molecule stopped at the round of 32 because `buildOddsConsensusBracket` never set `bestThirds` (REPAIR-NOTES open item 2 on PR #344).
**Branch**: `fix/molecule-consensus-best-thirds`, stacked on `fix/web-vitest-suite` (draft PR #344), worktree.

## Fix

`apps/web/lib/molecule/odds-consensus.ts` runs the cascade once on the group-stage picks and tiebreakers, reads each group's predicted third-placed team from `effective_order`, sorts the twelve by world rank (ties by group id) and keeps eight as `bestThirds`. World rank rather than consensus strength because the odds snapshot carries match odds only, no group-winner summaries; it also matches the rank-based tiebreakers the builder already uses. The knockout loop then fills the eight Annex C slots and reaches the final.

## Tests

`lib/molecule/test/odds-consensus.test.ts`: the OPEN case is un-skipped and passes; a new case checks eight unique thirds, one per group, ordered by rank. 9 pass under `systemd-run --user --scope -p MemoryMax=3G`. Odds are mocked; no Polymarket calls. eslint and tsc clean.

## Needs Tim

Merge after #344 (this branch contains it). No restart needed beyond the one the merge-order paper schedules for the web code PRs.
