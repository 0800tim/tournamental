---
status: done
agent: tournamental-agent
date: 2026-10-17
task: Unit tests for lib/archive/final-standings.ts and results-bracket.ts against fixtures (burn board, round 5)
refs: apps/web/__tests__/archive/
---

# Archive standings and results-bracket tests

## Done

- `__tests__/archive/final-standings.test.ts` (15 cases): rank order
  (points, correct picks, earliest lock), consecutive ranks on ties,
  limit, tournament scoping, whole-percent rounding and the zero-total
  guard, the returned shape (no population total), name resolution
  (display_name, handle, auth database, "Player"), missing or
  table-less database files, and the knockout-results filter, order
  and JSON tolerance. Throwaway SQLite files under the OS temp dir.
- `__tests__/archive/results-bracket.test.ts` (10 cases): empty
  bracket, group and knockout result copying, unknown ids and other
  tournaments ignored, and the best-third resolution from commit
  79286bb3: undefined while any group or fixture is unsettled, the
  eight best thirds ranked by points, goal difference and goals scored
  from a deterministic full group stage, and the team-code tie-break.
  In-memory persistence via `__setPersistenceForTests`.
- 25 passed; eslint clean.

## Observation, not changed

`loadKnockoutResults` filters match ids starting `r16`, `qf`, `sf`,
`tp` or equal to `final`, so the archive's knockout list starts at the
round of 16 and omits the 16 round-of-32 results. The results bracket
page shows them, so nothing is lost, but if the archive home is meant
to list "every knockout result" the filter needs `r32%` too. Pinned
by a test as current behaviour; flagged for Tim.

Draft PR, not merged.
