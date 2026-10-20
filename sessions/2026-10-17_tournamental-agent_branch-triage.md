---
status: done
agent: tournamental-agent
date: 2026-10-17
task: Branch triage report, read only (burn board, round 4)
refs: docs/reviews/2026-10-branch-triage.md
---

# Branch triage

After `git fetch --prune`: 56 remote branches merged into main, 171
not (the board said 167; four are today's draft PR branches). For each
unmerged branch the report gives last commit date, author, ahead and
behind counts, `git cherry` patch equivalence, top directories touched
and the first commit subject. 126 are fully patch-equivalent to main
(safe to delete), 1 partly, 31 have no equivalent patches but all but
one build something that exists on main today under a different
history. The one exception is `packages/commentary` on
`feat/commentary`, never landed. `next15-dev` is Tim's own upgrade
branch. Nine Dependabot branches listed separately.

Nothing deleted, nothing closed. Draft PR, not merged.
