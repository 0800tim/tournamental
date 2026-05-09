---
id: 0005
title: Historic-odds HUD widget for AR-FR demo
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P0
labels: [demo-critical-path, frontend, gamification]
links:
  issue: https://github.com/0800tim/vtorn/issues/8
  doc: docs/12-odds-and-predictions.md
---

## What

A small JSON-driven HUD overlay in the renderer that shows historic AR-FR Dec 2022 World Cup Final odds at key moments (kickoff, after each goal, pre-shootout).

## Why

Tim's demo brief mentions "live odds at the time" as part of the watchability. This is the v0.1 *display* slice — not the full odds-feed/scoring pipeline.

## Acceptance

- [ ] `apps/web/public/data/wc2022-final-odds.json` with snapshots covering all 9 key moments per issue #8.
- [ ] `<OddsHUD />` component mounted in the demo route; updates as match plays.
- [ ] Visible in the AR-FR demo screen capture.
- [ ] Methodology / source documented in `_meta` and CREDITS.md.

## Notes (rolling)

- Held in inbox until the renderer PR (#0002 / issue #4) lands. Once the renderer merges, this becomes a small follow-up PR.
- Tim's request: "the live odds at the time" — interpreted as historic closing line + score-state-modelled in-game numbers. Pre-match closing from public sources; in-game synthesised + clearly labelled.
