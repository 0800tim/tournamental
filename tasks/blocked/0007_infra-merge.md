---
id: 0007
title: Merge infra/conventions PR
owner: orchestrator
status: blocked
created: 2026-05-09
updated: 2026-05-09
priority: P1
labels: [infra, ops]
links:
  pr: https://github.com/0800tim/vtorn/pull/9
  doc: docs/22-deployment-and-tunnels.md
---

## What

Squash-merge PR #9 (`chore(infra): conventions, DB stack, backups, dependabot`).

## Why

It carries the port table, caching policy, performance review checklist, DB stack, backup script, dependabot config, analytics + gamification + secrets-required docs, and the kanban itself. Builders branch off main; the longer this lingers, the further their lockfiles drift.

## Acceptance

- [ ] CI green on PR #9 latest commit.
- [ ] Self-review against CONTRIBUTING.md checklist clean.
- [ ] Squash-merge with `gh pr merge 9 --squash --delete-branch`.

## Notes (rolling)

- 2026-05-09 17:0X — Blocked on CI completion (queued at push time).
- Reason for "blocked" tier: the orchestrator is the owner and the only blocker is "wait for CI", so this is genuinely a watch-the-build situation.
