# Phase 4 — Polish (Magnus curls, sweat normals, replay HUD, mobile perf pass)

> Final pass. Everything that makes the difference between "looks really good" and "looks like a TV broadcast still". Plus the rigorous mobile-perf review.

## Trigger

Phase 3 PR merged into `main`.

## Branch

`feat/fidelity-phase4-polish`

## Files to create / modify

```
packages/ball-physics/
  src/
    magnus.ts                           MODIFY — full curl model with spin estimation
  test/
    magnus-curl.test.ts                 NEW

apps/web/
  components/Player.tsx                 MODIFY — sweat normal, dirt stain on slide tackle
  components/HUD/
    ReplayHUD.tsx                       NEW — score, clock, "REPLAY" banner, slow-mo factor
    MatchClock.tsx                      NEW
    Scoreboard.tsx                      NEW
    SponsorRibbon.tsx                   NEW — bottom-of-screen rotating sponsor
  components/MatchScene.tsx             MODIFY — wire HUD overlay
  lib/perf/
    perf-monitor.ts                     NEW — fps + memory + draw-call HUD (?dev=1 only)
    perf-budget-test.ts                 NEW — assert budgets at runtime in dev
  shaders/
    sweat.glsl                          NEW — wet skin normal blend
    dirt.glsl                           NEW — slide tackle stain decal
  __tests__/full-match-perf.spec.ts     NEW — playwright, 90 min replay at time-scale=10
  __tests__/visual-regression.spec.ts   NEW — perceptual diff vs golden snapshots

docs/
  27d-fidelity-phase4-polish.md         THIS FILE
```

## Magnus curl (full)

Replace the constant side-force with a model:

```
F_magnus = S × (ω × v)
where S = 0.5 × ρ × A × C_l × |ω × v|
```

In practice we estimate ω (spin) per shot from event metadata:
- Free kick: high spin (~10 rev/s), direction inferred from foot side and run-up angle.
- Outside-foot pass: moderate spin (~5 rev/s).
- Knuckleball (rare): zero spin, no Magnus.

Calibrate: known free kicks (Messi vs Mexico 2022 group) should reproduce visible curl within ±20 cm of the historical end position.

## Sweat / dirt normals

Per-player wetness coefficient that increases over match time. Applied as a normal-map blend on jersey + skin:
- Sweat normal at 0% at kickoff, 60% at full-time, applied to skin texture roughness.
- Dirt decal triggered on `Slide Tackle` event, applied via a runtime decal projector to the affected jersey region.

Cheap: shader-only, no extra geometry.

## Replay HUD

```
┌─────────────────────────────────────────────────────────┐
│  ARG 1 - 0 FRA            23'        REPLAY  0.25×      │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│  [SPONSOR RIBBON ROTATING…]                             │
└─────────────────────────────────────────────────────────┘
```

- `Scoreboard.tsx`: top-left, two team flags + score + match clock.
- `MatchClock.tsx`: synced to renderer timeline, MM:SS format, +ET indicator.
- `REPLAY` banner: top-right, only visible during replay window, with slow-mo factor.
- `SponsorRibbon.tsx`: bottom-edge, rotating sponsor texture every 15 s.

All HTML overlay (not WebGL), so it's free in render budget. Position absolute over the canvas.

## Mobile perf pass

Run the full 90-min AR-FR replay at `time-scale=10` (so it takes 9 mins) on:

1. Pixel 7a (Playwright `--device="Pixel 7"`)
2. Galaxy A52 profile (custom)
3. iPhone 12 (Playwright `--device="iPhone 12"`)
4. Desktop high-DPI Chrome

Assert per-device:
- Median frame time within budget for the device's preset.
- p99 frame time < 33 ms.
- Memory < 350 MB on mobile, < 700 MB on desktop high.
- No console errors.

If any device fails, identify the offender (use Chrome DevTools timeline export from the Playwright trace) and either:
- Simplify the offending pass, or
- Down-tier the device's default preset.

## Visual regression

Maintain golden snapshots at:
- Kickoff
- Pre-Messi-pen (22:55)
- Post-Messi-pen celebration (23:30)
- Half-time bench
- Mbappé hat-trick pen run-up (118:00)
- Penalty shootout (Montiel winner)

Perceptual diff via `pixelmatch` with 0.05 tolerance.

## Tests

### Unit
- `magnus-curl.test.ts`: synthetic free kick at 25 m, assert ball end position lateral offset matches expected.
- `perf-budget-test.ts`: instrumented assertions that fail in dev if budgets exceeded.

### Playwright
- `full-match-perf.spec.ts`: 9-minute replay run, asserts perf budgets across devices.
- `visual-regression.spec.ts`: snapshot the 6 golden moments, diff against `test-fixtures/visual-golden/`.

## Acceptance criteria

- [x] Free-kick Magnus curl within ±20 cm of historical end positions for 3 calibration kicks.
- [x] Sweat + dirt visible from broadcast cam at full match time.
- [x] Replay HUD overlays correctly on every replay.
- [x] All 4 device profiles within budget for full-match perf test.
- [x] Visual regression suite passes.
- [x] Lighthouse on `/match/...` page: Performance > 80 (mobile), > 95 (desktop).

## Final orchestrator action

When this PR merges:
- Update `docs/27-fidelity-roadmap.md` summary table with `done ✓` marks.
- Tag `v0.5-fifa-fidelity-complete`.
- Open `IDEAS.md` ticket for "Phase 5 — WebGPU upgrade" (deferred; gated on browser support).
- Notify Tim with screencap + URL.
