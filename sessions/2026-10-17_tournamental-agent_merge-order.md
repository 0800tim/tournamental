# 2026-10-17, merge order for draft PRs #335 to #341

**Task**: burn round 6, write `docs/reviews/2026-10-draft-pr-merge-order.md` on a docs branch in a worktree, merging nothing.
**Branch**: `docs/draft-pr-merge-order`.

## Method

`gh pr list` and `git diff --stat origin/main...<branch>` for the file lists; `git merge-tree --write-tree` chained through `git commit-tree` to simulate every merge in the proposed order without touching a working tree; the curl checks taken from the runbook in PR #338.

## Finding

PR #335's locale fix in `apps/web/middleware.ts` had never been committed; it was sitting modified in the PR's worktree. Committed as a29e3592 on the same branch and pushed. With it, #335 and #336 both touch the middleware, 130 lines apart, and merge cleanly in either order.

## Outcome

Review written: shared files, order (#335, #336, #340, #338, #337, #339, #341), one `tournamental-web` build and restart after the two code PRs, curl checks A to C with expected values, and the vitest commands for bigmac. Draft PR opened. Nothing merged, built or deployed.
