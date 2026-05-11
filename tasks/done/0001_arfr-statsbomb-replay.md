---
id: 0001
title: AR-FR 2022 producer (apps/statsbomb-replay)
owner: agent:statsbomb-replay
status: done
created: 2026-05-09
updated: 2026-05-09  # closed
priority: P0
labels: [demo-critical-path, producer, python]
links:
  issue: https://github.com/0800tim/vtorn/issues/3
  doc: docs/11-historic-data-sources.md
---

## What

A spec-conformant Python producer that streams the 2022 FIFA World Cup Final (Argentina 3–3 France, 4–2 pens) from StatsBomb open data over WebSocket, ready for the renderer to consume.

## Why

It is the AR-FR demo's data source. Without it, there is no demo.

## Acceptance

- [ ] Streams a spec-valid sequence (validated against `@tournamental/spec`) for the full match including ET and pens.
- [ ] Final `event.score_change` carries 3-3 at 90+ET; final `event.penalty_shootout_end` carries Argentina, 4-2.
- [ ] All major event timestamps within 30s of actual match timeline.
- [ ] `--time-scale=10` plays the entire match in ≈ 15 wall-minutes.
- [ ] At least one pytest parsing-correctness test.

## Notes (rolling)

- Background agent dispatched 2026-05-09 with isolation:worktree.
- Subagent ID is internal (orchestrator only).
- Latest orchestrator update: agent still working as of 2026-05-09 17:0X NZST.
