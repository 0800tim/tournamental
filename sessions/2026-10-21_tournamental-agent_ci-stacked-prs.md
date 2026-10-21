# 2026-10-21 tournamental-agent: CI for stacked pull requests

**Branch**: `ci/stacked-pr-checks`, worktree, draft PR.
**Refs**: .github/workflows/ci.yml, .github/workflows/pr-security.yml

## Plan

Draft PRs #369 and #374 are stacked on other feature branches and sat
at "no checks reported" even after a close and reopen. Both PR
workflows filter `pull_request` on `branches: [main]`, so a PR whose
base is a feature branch never triggers them. Drop the base filter on
the `pull_request` event in both workflows and keep the `push` filter
on main so a merge still runs the suite once.

## Decisions

- `pull_request:` with no filter keeps the default activity types
  (opened, synchronize, reopened). The security workflow keeps its
  explicit list, which adds ready_for_review.
- The concurrency groups already key on the PR ref or number, so
  stacked PRs do not cancel each other.
- The triage bot uses only the GitHub token, so widening the trigger
  adds no paid calls.

## Outcome

Two-line trigger change in each workflow, YAML parsed to confirm the
triggers. The stacked PRs already open will get checks once their
base branch carries this change or they are retargeted to main after
the branch below them merges. Note that a retarget fires `edited`,
which is not a default activity type, so the retarget itself does not
re-run the checks; the next push does, and the merge into main runs
the suite once via `push`. (`edited` is deliberately not added: it
also fires on title and body edits.)

## Next steps

- Merge order unaffected. Nothing needs Tim beyond the merge itself.
