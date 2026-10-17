# 2026-10-17, round of 32 on the archive home

**Task**: burn round 6, list the round of 32 on the archive home. Stacked on `test/archive-standings-fixtures` (PR #340).
**Branch**: `feat/archive-r32-results` (worktree).

## What changed

- `apps/web/lib/archive/final-standings.ts`: `loadKnockoutResults` now also selects `r32%` match ids. New exports `KNOCKOUT_STAGE_ORDER` (f, tp, sf, qf, r16, r32) and `KNOCKOUT_STAGE_LABEL`, so the page and the loader share one list.
- `apps/web/app/archive/page.tsx`: uses the shared order and labels instead of its own `stageOrder` and `STAGE_LABEL`, which started at r16 and so left out the 16 round-of-32 results.
- `apps/web/__tests__/archive/final-standings.test.ts`: the "leaves out r32" case becomes "includes r32"; new cases for the 16 round-of-32 rows, the order (final first, r32 last), a label for every stage, and that every stage the loader produces from fixture ids is one the page lists. Throwaway SQLite files only.

## Checks

- `vitest run __tests__/archive`: 29 passed.
- eslint on the three files: clean. tsc: no errors in the two changed modules.
- Live archive home today lists 32 knockout matches from the round of 16 up; after deploy it will list 48.

## Needs Tim

Merge after PR #340 (this branch contains it), build `apps/web`, restart `tournamental-web`, then check the archive home shows a "Round of 32" block with 16 rows.
