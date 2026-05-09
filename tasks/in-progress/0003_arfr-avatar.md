---
id: 0003
title: Avatar pipeline (packages/avatar + apps/web/public assets)
owner: agent:avatar
status: in-progress
created: 2026-05-09
updated: 2026-05-09
priority: P0
labels: [demo-critical-path, assets, three-js]
links:
  issue: https://github.com/0800tim/vtorn/issues/5
  pr: https://github.com/0800tim/vtorn/pull/10
  doc: docs/07-avatars-and-assets.md
---

## What

Procedural avatar pipeline: shared body GLB, runtime jersey textures, billboard faces from Wikidata, Mixamo-compatible animation set. Ready for the renderer to consume as a workspace dependency.

## Why

The renderer treats the avatar package as a black box; without it, players are placeholder cubes and the demo doesn't read as football.

## Acceptance

- [x] `makeJerseyTexture` + cache, `<BillboardFace />`, `loadSharedBody`, `applyJersey`, `ANIMATION_FILES` manifest, `loadAnimationLibrary`.
- [x] 13 vitest tests pass; typecheck clean.
- [x] `apps/web/public/models/body.glb` (26KB, 800 tris, Mixamo-compatible).
- [x] `apps/web/public/animations/*.glb` (15 files; 3 unique seed clips, 12 stubs documented in IDEAS.md).
- [x] `data/wc2022-final-players.csv` with 22 verified Commons URLs.
- [x] Asset bundle ≤ 30MB (actual: 460KB).
- [x] `apps/web/public/CREDITS.md` complete.

## Notes (rolling)

- PR #10 OPEN — ready for orchestrator review.
- Stats: 36 files, +3722/-9.
- Open questions for orchestrator (from agent's report):
  - Should `@vtorn/avatar` export a single composed `<Player />` or stay primitive-only? Default chosen by builder: primitives — renderer composes them.
  - Renderer agent's `feat/web-renderer` branch creates empty `apps/web/public/{models,animations,data}/` dirs that this PR populates. Merge order TBD by orchestrator; no conflict either way.
