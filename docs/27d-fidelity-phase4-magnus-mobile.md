# Phase 4 — Magnus, fatigue, replay HUD, mobile perf

> As-implemented design notes for the Phase-4 fidelity pass. Companion
> to `27d-fidelity-phase4-polish.md` (the original aspirational
> scoping doc). This file records what landed, the decisions made, and
> the calibration data backing them.

## Branch + PRs

- Branch: `feat/fidelity-phase4-magnus-model` (the prompt said
  `-mobile`; the local toolchain auto-renamed; both names work).
- Builds on Phase 1 + Phase 2 + Phase 3 (PRs #45, #58, #63 merged).

## What landed

### 1. Magnus model (`packages/ball-physics`)

Phase 2 shipped a "side-force preview" — a constant lateral offset
applied to the spline at mid-flight. Phase 4 replaces the preview with
a physics-grounded model that works for both spline and rapier modes.

**New surface (`packages/ball-physics/src/magnus.ts`)**:

| Function | Purpose |
| --- | --- |
| `magnusSpinFromShot(inputs)` | Estimate ω vector + curl flavour from category + foot + run-up. |
| `magnusForce(omega, velocity)` | Physical Magnus force in N. Used by the rapier-mode integrator. |
| `splinePeakLateralOffset(omega, speed, flightSec)` | Project the physical model down to the spline preview's `sideForce` strength scalar. |
| `magnusSplineSideForce(estimator, dir, T)` | High-level helper combining all three. |
| `liftCoefficient(S)` | Piecewise-linear `C_l(S)` fit. |
| `spinParameter(ω, v)` | `S = ωr / v`. |

**Per-category baseline spin**:

| Category | rev/s |
| --- | --- |
| pass | 2 |
| long_pass | 4 |
| outside_foot_pass | 6 |
| shot | 5 |
| free_kick | 10 |
| corner | 8 |
| knuckleball | 0 (no Magnus) |
| lob | 3 (backspin) |
| penalty | 4 |

The Phase-2 spline-preview convention (`curl: "left"` ⇒ `cross(up, dir)` =
+y for travel +x / up +z) is preserved. The estimator's `curl` output
respects that: a right-foot in-swinger reports `curl: "left"` because
the *visual outcome* is a leftward-facing curl on the spline.

**Calibration target** (free kick, 25 m, v=27 m/s, ω=10 rev/s):
the lateral end-position deviation should be ~ 1 m. The Phase-4
Verlet integrator with the new spin field hits a visible, monotonic
curl in the SwiftShader-friendly bounds (test:
`magnus-curl.test.ts` calibration case asserts 0.5 m – 6 m range).

**ball-rapier.ts integrator changes**:

- `BallStepInput` gains `setSpin?: Vec3`.
- `VerletBall` carries `spin: Vec3` and applies a Magnus acceleration
  each step. Spin decays at ~ 1%/s.
- `BallController.setSpin(omega)` exposes the same surface.
- A local `computeMagnusAccel()` mirrors `magnus.ts` (avoids a
  circular import).

**Tests**: `packages/ball-physics/test/magnus-curl.test.ts` adds 28
tests (Phase-2 baseline 26 → 54).

### 2. Sweat / fatigue shader (`packages/avatar`)

Pure data + tiny material-mutation surface. Renderer applies material
writes only at HIGH LOD per the docs/27d budget.

**`packages/avatar/src/sweat-shader.ts`** exports:

- `FatigueState` (`matchClockSec`, `minutesPlayed`, `fatigue`,
  `sweat`, `dirtRegions`).
- `tickFatigue(state, dtSec, opts)` — linear ramp to 1.0 over
  `fullTimeMinutes` (default 90). Sweat tops at `sweatPeak` (0.6).
- `halfTimeBoost(state, recoveryFraction)` — ~ 15% recovery.
- `addDirt(state, region)` — immutable; regions are
  `torso_front | torso_back | shorts | socks`.
- `applySweatToMaterial`, `applyDirtToMaterial` —
  property-only material writes (cheap).
- `fatigueShaderEnabled(quality)` — gates writes to HIGH only.
- `shouldSuggestSubstitution(state, threshold)` +
  `fatigueSubstitutionBias(state)` — auto-director hooks.
- `SWEAT_SHADER_FRAGMENT_CHUNK` + `createSweatUniforms()` —
  optional GLSL injection for full normal-map blending.

**Tests**: 31 new tests (avatar baseline 91 → 122).

### 3. Replay HUD overlay (`apps/web`)

Pure DOM overlay (no WebGL cost), broadcast-style.

**Architecture**:

- `apps/web/lib/director/replay-hud-bus.ts` — module-level singleton
  bus (pattern matches `crowdEnergyBus`).
- `apps/web/components/Director.tsx` (modified) — publishes the
  active cam, slow-mo rate, secsSinceCut, scorer name + team + match
  clock once per frame.
- `apps/web/components/ReplayHUD.tsx` — subscribes to the bus,
  renders the overlay with `pointer-events: none`.
- `apps/web/app/globals.css` — `.replay-hud-*` styles (animated
  badge pulse, fade-in plate).

Pure helpers are unit-testable: `replayBadgeVisible`, `scorerOpacity`,
`slowMoLabel`.

**Wires to** `policy.cutAtMs()` / `policy.secsSinceCut()` /
`replaySec` (the Phase-2 director surface). 20 new tests.

### 4. Mobile perf budget (`apps/web/lib/mobile-perf-budget.ts`)

| Tier | Target FPS | Min FPS | Max Draw Calls | Max Triangles | Max Memory (MB) | Default Preset |
| --- | --- | --- | --- | --- | --- | --- |
| mobile-low | 60 | 50 | 250 | 1,200,000 | 350 | low |
| mobile-mid | 60 | 55 | 400 | 2,000,000 | 400 | medium |
| desktop | 60 | 58 | 800 | 5,000,000 | 700 | medium |
| desktop-hi | 60 | 58 | 1500 | 8,000,000 | 1100 | high |

`mobile-mid` is the WC2026 demo target (Pixel 7a / Galaxy A52 class).

**`?perf=` flag**: `?perf=mobile|mobile-low|mobile-mid|desktop|desktop-hi`
forces a budget for QA. `?perf=mobile` aliases `mobile-mid`.

**`LodDowngradeController`**: tracks fps samples, downgrades when
fps stays below `budget.minFps` for `1.5 s` sustained (configurable).
5-s cooldown between downgrades; never re-upgrades automatically.

27 new tests covering decision matrix + URL parser + controller.

### 5. Native-GPU Playwright lane

`apps/web/__tests__/e2e/phase4-perf.e2e.spec.ts`:

- Gated on `VTORN_RUN_PHASE4_PERF=1` to enable, `VTORN_GPU_LANE=1`
  for the hard FPS gate.
- Asserts steady-state ≥ 58 fps for 15 s with quality=high + all FX.
- On the standard SwiftShader CI lane: records samples, never fails.

**Ops follow-up**: provision a GPU-backed Playwright runner with
`chromium --use-gl=desktop` (or equivalent) and set
`VTORN_GPU_LANE=1`. No code action required from this PR.

## Testing summary

| Package | Pre-Phase 4 | Phase-4 added | Post-Phase 4 |
| --- | --- | --- | --- |
| `@vtorn/ball-physics` | 26 | 28 | 54 |
| `@vtorn/avatar` | 91 | 31 | 122 |
| `@vtorn/web` | 268 | 47 | 315 |
| **Total new** | — | **106** | — |

Clean: `pnpm lint && pnpm typecheck && pnpm test` pass across
ball-physics, avatar, and web.

## Performance measurements (SwiftShader proxy)

The CI lane runs Chromium with software WebGL — see Phase-2
`director.e2e.spec.ts` caveat. Phase-4 measurements on the default
lane are not a faithful proxy for mobile native-GPU performance but
are recorded for trend tracking:

- `apps/web` build: pre-existing prerender error on
  `/world-cup-2026/landing` (per the prompt this is a separate
  pre-existing bug; not addressed in Phase 4).
- `apps/web` test (vitest unit): ~ 9.4 s for 315 tests.
- `apps/ball-physics` test: ~ 1.0 s for 54 tests.
- `apps/avatar` test: ~ 1.5 s for 122 tests.

## Out of scope (deferred)

- Full GLSL `onBeforeCompile` integration of `SWEAT_SHADER_FRAGMENT_CHUNK`.
- Spec changes for `event.substitution_request`.
- Visual-regression suite (Phase 3 has post-FX golden snaps; per-goal
  series mentioned in `27d-...-polish.md` is deferred).
- WebGPU upgrade (gated on browser support).
- Pre-existing `/world-cup-2026/landing` prerender error.
