---
id: 0002
title: Renderer (apps/web)
owner: agent:web
status: done
created: 2026-05-09
updated: 2026-05-09  # closed
priority: P0
labels: [demo-critical-path, frontend, r3f, nextjs]
links:
  issue: https://github.com/0800tim/vtorn/issues/4
  doc: docs/04-renderer.md
---

## What

A Next.js 14 + React Three Fiber app that connects to the producer's WebSocket and renders the AR-FR 2022 final at 60fps with HUD, animation FSM, broadcast camera modes, and the historic-odds widget hook.

## Why

It is the user-visible end of the demo. Tim wants this watchable on `https://play.tournamental.com` ASAP.

## Acceptance

- [ ] Connects to `ws://localhost:4001` (configurable via env).
- [ ] Renders 22 players + ball + pitch at 60fps mid-range Android.
- [ ] StateFrame lerp smooth at 10Hz input.
- [ ] Animation FSM by speed; one-shots on `event.*`.
- [ ] HUD shows score, clock, commentary line, last-event banner.
- [ ] Camera toggle works (broadcast / top-down / follow-ball).
- [ ] Score reads 3-3 ET, then 4-2 pens for AR-FR replay stream.
- [ ] `<OddsHUD />` placeholder reads from `apps/web/public/data/wc2022-final-odds.json`.

## Notes (rolling)

- Background agent dispatched 2026-05-09 with isolation:worktree.
- Port assigned: **3300** (per `docs/22-deployment-and-tunnels.md`). Tunnel `play.tournamental.com` already routes here.
- Build coordinates with #0003 (avatar) for body GLB and animations; renderer can stub with cubes if avatar PR not yet landed.
