---
id: 0004
title: Mock producer (apps/mock-producer)
owner: agent:mock-producer
status: in-progress
created: 2026-05-09
updated: 2026-05-09
priority: P0
labels: [demo-critical-path, producer, node-ts]
links:
  issue: https://github.com/0800tim/vtorn/issues/6
  doc: docs/05-mock-producer.md
---

## What

Deterministic synthetic 90-min match generator that emits the same wire protocol as the StatsBomb-replay producer, used by the renderer for fast dev iteration.

## Why

Renderer agent should not be blocked on real data. Mock producer is the smallest of the four AR-FR builds (~half a day) and gives the renderer something to point at within hours.

## Acceptance

- [ ] Same `--seed` produces byte-identical output.
- [ ] Output passes spec validation.
- [ ] All standard event types appear ≥ once in default 90-min match.
- [ ] Renderer connected via `--out ws --port 4001` shows continuous, plausible motion.
- [ ] Determinism + spec-validation tests in vitest.

## Notes (rolling)

- Background agent dispatched 2026-05-09 with isolation:worktree.
- Default port: 4001 (matches docs/05; renderer connects here).
