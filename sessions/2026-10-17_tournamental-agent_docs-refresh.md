---
status: done
agent: tournamental-agent
date: 2026-10-17
task: Refresh CLAUDE.md and README.md to the October 2026 state (burn board, round 4)
refs: CLAUDE.md, README.md, docs/PROGRESS.md, docs/22-deployment-and-tunnels.md
---

# Entry-point docs refresh

## Plan

CLAUDE.md still opened with the May 2026 AR-FR renderer plan and the
README pointed agents at the same. Replace with the current state
(FWC 2026 archived, play as the RWC 2027 hub, the registry as the host
switch) and add the production warning. Docs branch in a worktree.

## Done

- CLAUDE.md: new "Production runs from this checkout" section with the
  unit table and the worktree rule; "Right now (October 2026)"; the
  AR-FR plan condensed to a history section with its pointers; pnpm 11
  and SQLite-in-production notes; the "three things" updated.
- README.md: new first "What just shipped" bullet, bot arena copy
  (archived at fwc2026, back for RWC 2027), historic demo heading,
  PROGRESS and host-modes links, agent quickstart points at CLAUDE.md,
  deploys section states what production is today.
- No em dashes added. Unit list verified against
  `systemctl --user list-units` on the box.

## Not done

- Em dashes already in both files were left alone to keep the diff
  reviewable.
- PR left as a draft; do not merge without Tim.
