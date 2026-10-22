# 2026-10-22 tournamental-agent: share summary lists only the rounds the tournament plays

**Branch**: `feat/game-summary-path-by-tournament`, stacked on `feat/game-vendored-tournaments` (PR #374), worktree, draft PR.
**Refs**: IDEAS.md (2026-10-22 rwc2027 line), apps/game/src/routes/bracket-cascade-summary.ts

## Plan

The share-page summary built its `knockout_path` from a fixed list
(r32, r16, qf, sf, final), so a Rugby World Cup 2027 bracket carried a
permanent `r32: tbd` row. Derive the stages from the cascaded
knockouts, which already carry every fixture's stage, keeping the
fixed order and the full list as the fallback for an empty cascade.

## Decisions

- Read from the cascade, not the tournament, so `summariseFromCascade`
  keeps its signature and #373's tests stay valid.
- The web share page pads the path to five rounds on its own
  (`normaliseUpstream` in apps/web/lib/bracket/by-guid.ts, pinned by a
  test); that is handled on `fix/web-share-path-by-tournament`.

## Outcome

Three tests: RWC 2027 full bracket gives r16, qf, sf, final with every
opponent resolved; 2026 keeps five; an empty RWC bracket lists the four
rounds as tbd. Game typecheck clean; summary and by-guid suites pass.

## Review follow-up (same day)

An independent review noted that `KnockoutPathEntry.result` declared a
"loss" value the summariser never produces: the champion only appears in
a round by winning the one before, so the value is "win" or "tbd". The
type now says so and the stale comment is gone. The `pathStagesFor`
comment also says that its full-list fallback only triggers when the
cascade has no knockouts at all, which an empty bracket does not hit
(the cascade emits one entry per fixture whether or not it has picks).
3 tests pass, typecheck clean.
