# 2026-10-17, unlanded branches review

**Task**: burn round 6, `docs/reviews/2026-10-unlanded-branches.md` for `feat/commentary` and `next15-dev`. Read only.
**Branch**: `docs/unlanded-branches` (worktree, docs only).

## Method

Commit lists, diffs and `git merge-tree` dry runs against main; a throwaway detached worktree of main with `packages/commentary` checked out from the branch to measure what landing takes (spec rename, vitest 4, one stale test fixture; 11 tests pass; source compiles). The scratch worktree was removed afterwards.

## Calls

`feat/commentary`: the package is the event-to-text generator main still lacks under its ElevenLabs stream and pre-render manifest, so it fits the renderer roadmap, not the RWC 2027 hub plan; football-shaped templates and spec. Half a day to land as a fresh package-only branch when the watch-along is back on the roadmap; keep the branch as a reference until then. `next15-dev`: one unique commit (dev-only version bumps); everything else is on main by subject. Copy the version table into the Next 15 plan and delete the branch; the real work is the four React Three Fiber majors.

## Found on the way

The CI typecheck failure on main is two errors in `packages/bot-sdk/examples`.

## Outcome

Draft PR opened. Needs Tim: the two calls above.
