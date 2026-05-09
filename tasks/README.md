# Project tasks

A lightweight markdown kanban for VTourn. Lives in-repo so the orchestrator and any agent can see and update it. No external tool. Survives across sessions because it's just files.

## Layout

```
tasks/
├── README.md          (this file)
├── BACKLOG.md         (the long list — anything we've thought of but not pulled into work)
├── ROADMAP.md         (sprint-shaped: what's planned for now / next / later)
├── inbox/             (one .md per new task; not yet triaged)
├── in-progress/       (one .md per task currently being worked, including by background agents)
├── blocked/           (one .md per task waiting on a person, key, or upstream change)
└── done/              (one .md per completed task; trimmed quarterly)
```

## Task file convention

Each task is a single markdown file. Filename:

```
<NNNN>_<short-slug>.md         e.g.  0042_admin-dashboard-mvp.md
```

`NNNN` is a monotonically-increasing 4-digit ID. Allocate the next one with `ls tasks/{inbox,in-progress,blocked,done}/*.md 2>/dev/null | sed 's/.*\///' | awk -F_ '{print $1}' | sort -n | tail -1` and add 1.

Frontmatter:

```yaml
---
id: 0042
title: Admin dashboard MVP
owner: agent:admin            # or a GitHub handle, or "unassigned"
status: in-progress           # inbox | in-progress | blocked | done
created: 2026-05-09
updated: 2026-05-09
priority: P1                  # P0 critical, P1 next, P2 nice-to-have, P3 later
labels: [admin, analytics]
links:
  pr: https://github.com/0800tim/vtorn/pull/N    # if any
  issue: https://github.com/0800tim/vtorn/issues/N
  doc: docs/23-analytics-and-marketing-insights.md
---

## What

One sentence describing the outcome. Not the work, the outcome.

## Why

One or two sentences on motivation. Tie back to a strategy doc, business reason, or user-facing impact.

## Acceptance

- [ ] First testable criterion.
- [ ] Second testable criterion.
- [ ] Performance / caching / security treatment matches docs/22 + docs/23.

## Notes (rolling)

Free-form. Add as you work.
```

## Workflow

1. **New thought** → `tasks/inbox/<n>_<slug>.md`. Don't agonise; capture.
2. **Triage** (orchestrator does this daily) → move to in-progress, blocked, or BACKLOG.md (one-liner reference).
3. **Picked up** → status `in-progress`, owner set, file moves to `tasks/in-progress/`.
4. **Stuck on something external** → status `blocked`, file moves to `tasks/blocked/`, **why** captured under Notes.
5. **Done** → status `done`, file moves to `tasks/done/`, leave a 1-line outcome under Notes.

When a task moves directories, **do it in the same commit as the status change** so the file's git history matches the kanban.

## What lives where

- **`BACKLOG.md`** — anything we know we'll do eventually but isn't on the radar this sprint. One line per item: `[#0042] Admin dashboard MVP — P1 — links to detailed task file when promoted to in-progress`.
- **`ROADMAP.md`** — the current sprint shape: what's targeted now / next / later. Updated by the orchestrator when sprint scope changes.
- **`tasks/inbox/`** — uncurated, brand-new. Should be near-empty after the orchestrator's daily triage.
- **`tasks/in-progress/`** — what agents are actively working on. Mirrors `gh pr list --state=open` for engineering work, but covers non-PR work (research, doc writing, ops) too.
- **`tasks/blocked/`** — held tasks. Each file's Notes section names the blocker so the orchestrator knows what to nudge.
- **`tasks/done/`** — completed. Quarterly: `git mv` the oldest 30 days into `tasks/done/archive/<YYYY-Q[1-4]>/` to keep the directory readable.

## Why this and not GitHub Issues alone

GitHub Issues are how external contributors interact with us. They're public-facing, comment-heavy, and move at GitHub's pace. The kanban is for *internal coordination* between the orchestrator, the builder agents, the reviewer agent, and Tim — fast, structured, in-repo, diffable.

A task and an issue are not the same thing. Many tasks are doc-only or research-only and don't need a GitHub issue. Issues that *do* exist are linked from the task file's frontmatter `links.issue`.
