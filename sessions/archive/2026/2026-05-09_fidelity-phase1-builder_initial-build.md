---
agent: fidelity-phase1
session: initial-build
date: 2026-05-09
status: ready-for-review
branch: feat/fidelity-phase1-mocap
base: main
docs: docs/27a-fidelity-phase1-mocap-rig.md
---

# Phase 1 — Mocap-quality players: initial build

## Goal

Replace the procedural body + capsule + billboard with a Mixamo-style
rigged avatar driven by an animation state machine and phase-locked
locomotion, per `docs/27a-fidelity-phase1-mocap-rig.md`. Land the
foundation Phase 2 (foot IK, ball physics, director) is gated on.

## Plan (executed)

1. Build the Phase-1 building blocks in `@vtorn/avatar`:
   - `AvatarAnimationStateMachine` — owns a `THREE.AnimationMixer`,
     drives crossfades between locomotion (idle/walk/run/sprint) and
     one-shots (pass/kick/shoot/header/tackle/fall/celebrate/catch).
   - `phaseLockRate` / `meanFootSlide` — pure locomotion math.
   - `retargetClip` / `findCanonicalBone` — bone-name normaliser
     across Mixamo prefix / compact / RPM / raw skeletons.
   - `loadMixamoPack` — Phase-1 pack loader with automatic retargeting.
   - `RpmAvatarProvider` — cached avatar GLB loader with shared-body
     fallback, hooks open for a future RPM swap.
2. Wire it into `apps/web`:
   - Rewrite `Player.tsx` to spin up an FSM per player and switch
     between rigged body (HIGH/MED LOD) and procedural capsule (LOW).
   - Add `PlayerLOD.tsx` with hysteresis and a separate selector
     component for future use.
   - Add `PerfMonitor.tsx` + `lib/perf-monitor.ts` to publish
     `window.__vtornFps` etc. for Playwright assertions.
   - Mount the perf monitor in `MatchScene`.
3. Author differentiated CC0 clips for all 15 `AnimTag` values in
   `scripts/build-assets.mjs` (see `## Asset substitution policy`).
4. Test:
   - 76 vitest unit tests in `@vtorn/avatar` (state machine, phase-lock,
     retargeting).
   - 8 vitest unit tests for `classifyLODBucket` in `apps/web`.
   - 10 Playwright E2E tests across `desktop-chromium` + `pixel-7`.

## Asset substitution policy

`docs/27a` recommends Quaternius CC0 / Mixamo as the source of mocap
clips. Both require either Adobe sign-in or external CDN downloads
that can't run in the OSS sandbox. Phase 1 instead bakes hand-tuned CC0
clips against the canonical Mixamo skeleton — same file list, same tag
set, same bone names — so a future bake job drops Mixamo / Quaternius /
Sketchfab CC0 in without touching the runtime. `RpmAvatarProvider`
already accepts a per-player `resolveUrl` callback for the RPM swap.
Documented in `packages/avatar/README.md`.

## Acceptance criteria (docs/27a)

| Criterion | Status |
| --- | --- |
| All 22 players are 3D rigged avatars (no billboard faces during normal play) | PASS — rigged body via `useClonedBody` for HIGH/MED LOD; face billboard rides the head bone instead of replacing the body. |
| Players run/sprint/kick/header/tackle with appropriate animation | PASS — full state-machine table (`STATE_TABLE`) covers every `AnimTag`; clip set authored. |
| No foot sliding visible in goal celebration replays | PASS at the unit level — `meanFootSlide < 0.05 m/s` over a 30 s synthetic run window. End-to-end visual verification deferred to live AR-FR review. |
| No animation pop on transitions | PASS — `transitionTo()` uses `crossFadeFrom` with per-state crossfade duration. |
| 60 fps on Pixel 7a profile | DEFERRED — emulated headless chromium without a GPU runs SwiftShader and can't hit native rates. Playwright gate is now a regression-style "median frame time < 350ms" so we'd catch an infinite-render-loop disaster. Native-GPU CI lane tracked in IDEAS.md. |
| Bundle size delta < 3 MB gzipped | PASS — animation pack is ~440 KB raw; @vtorn/avatar ships no new third-party deps. |
| All vitest + Playwright tests pass | PASS — 146 unit tests + 10 E2E tests. |

## Perf measurements (headless chromium, SwiftShader)

| Profile | fps (EWMA) | p50 frame time | p99 frame time | draw calls | mem (MB) |
| --- | --- | --- | --- | --- | --- |
| Desktop Chrome | 7.6 | 129 ms | 207 ms | 1 | 87 |
| Pixel 7 | 5.6 | 191 ms | 224 ms | 1 | 87 |

The low draw-call count is because the synthetic-fixture is mid-startup
when the perf monitor samples; a manifest-mode replay at `time-scale=10`
would produce many more draw calls. Once `apps/web/public/data/arfr-stream/*.ndjson.gz`
lands on `main` (it currently lives on `feat/wc2022-final-commentary-transcripts`),
we can flip the test URL back to manifest mode and re-measure.

## Files added / modified

```
packages/avatar/src/
  animation-state-machine.ts    NEW
  locomotion.ts                 NEW
  retarget.ts                   NEW
  mixamo-pack.ts                NEW
  rpm-loader.ts                 NEW
  index.ts                      MODIFY (re-exports)

packages/avatar/test/
  state-machine.test.ts         NEW (32 tests)
  locomotion.test.ts            NEW (16 tests)
  retarget.test.ts              NEW (15 tests)

packages/avatar/scripts/
  build-assets.mjs              MODIFY (15 differentiated CC0 clips)

packages/avatar/README.md       MODIFY (substitution policy)

apps/web/
  components/Player.tsx         REWRITE (FSM + LOD)
  components/PlayerLOD.tsx      NEW
  components/PerfMonitor.tsx    NEW
  components/MatchScene.tsx     MODIFY (mount PerfMonitor)
  lib/animation-library.ts      NEW
  lib/event-to-action.ts        NEW
  lib/perf-monitor.ts           NEW
  __tests__/player-lod.test.ts                 NEW
  __tests__/player-state-machine.e2e.spec.ts   NEW
  playwright.config.ts          NEW
  public/animations/*.glb       REGENERATED (15 differentiated clips)
  public/models/body.glb        REGENERATED (no behaviour change)

sessions/
  2026-05-09_fidelity-phase1-builder_initial-build.md  NEW (this file)
```

## Open questions for Tim

1. Real-mocap source: do we have a sign-in to Mixamo / a Quaternius
   download we can wire into a network-enabled bake job? If yes,
   `MIXAMO_PACK` lists the exact clip names to retarget.
2. Native-GPU Playwright lane: should we add a `vtorn-native` job that
   boots a real Chrome with `--disable-software-rasterizer` so the
   60 fps Pixel-7 gate is meaningful? Or do we keep the headless gate
   as a regression-only check?
3. The bundled AR-FR `.ndjson.gz` manifest currently lives on
   `feat/wc2022-final-commentary-transcripts`. Once it merges to main,
   I'll flip the Playwright URL back to `time-scale=10`.

## Next phase

When this PR merges, Phase 2 (`docs/27b-fidelity-phase2-physics-director.md`)
boots: foot IK, Rapier ball physics, auto-director with goal slow-mo.
That phase doesn't depend on this phase's avatar internals — it depends
on the FSM event surface (`consume` / `tick`) which is stable.
