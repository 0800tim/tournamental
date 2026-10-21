# 2026-10-22 tournamental-agent: share page pads the path to the tournament's rounds

**Branch**: `fix/web-share-path-by-tournament`, stacked on `feat/rwc-2027-fixtures` (PR #369), worktree, draft PR.
**Refs**: apps/web/lib/bracket/by-guid.ts, PR #377 (game side)

## Plan

`normaliseUpstream` padded every bracket's path to gold to the five
2026 rounds (pinned by a test since 1461c394), so a Rugby World Cup
2027 share page would show a Round of 32 row that the tournament
never plays. Pad to the rounds the vendored fixtures carry instead,
keyed by the upstream `tournament_id`, with the full list for an
unknown id.

## Decisions

- Stage list read once per tournament id from `loadFixtures` and
  cached in a module map: this runs per share-page request.
- The 2026 contract is unchanged (the pinned test still passes).
- `TOURNAMENT_LABEL` gains "Rugby World Cup 2027".
- Not touched: team names on the share page still come from the 2026
  `teams.json`, so rugby codes would show without names until the
  rugby route family lands (Needs Tim).

## Outcome

One new test (rugby bracket: r16, qf, sf, final, labels and
tournament label). Share-by-guid and resolver suites pass (23);
`tsc` and eslint clean.
