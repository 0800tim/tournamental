# 43 — Renderer fidelity overhaul (2026-05-11)

> Tim watched the AR-FR demo on his mobile and reported it jittered: the field jerks back and forth, players still aren't smooth, and the benchmark (the [three.js skinning-blending example](https://threejs.org/examples/#webgl_animation_skinning_blending)) renders buttery-smooth on the same hardware. This doc records the diagnosis and fix, so future agents understand why the renderer looks the way it does today and don't undo any of it.

## Diagnosis

Walked the renderer + producer + store and isolated four root causes:

1. **Synthetic-stream pacing collapses interpolation.**
   `packages/spec-client/src/synthetic.ts` paces ~7300 messages at `messagesPerTick ≈ 4` every 50 ms. State frames are 1 *match-second* apart. When 4 frames land in one tick they all stamp the store with the same wall-clock instant, so `prevWallMs === currWallMs` for the burst → `alphaForNow` saturates at 1 → renderer snaps to `curr` every tick. Between ticks (50 ms idle) no interpolation happens because the prev/curr pair was already burned through. Players move ~4 m per match-second; that's the visible "teleport every 50 ms" judder.

2. **Camera writes were unsmoothed.**
   `Director.tsx` did `camera.position.copy(evalOut.position)` and `camera.lookAt(...)` directly each frame. The `CutBlender` provides eased *transitions between cams* (200-400 ms cosine), but the *target itself* — e.g. broadcast tracking the ball x — moves discontinuously every state frame, so the camera snapped each tick. Add to that the position-jitter from problem #1 and you get the field-jerk Tim observed.

3. **`useFrame` deltas were unclamped.**
   On a stall (tab switch, GC pause, low-end mobile background tab), R3F passes a large `delta`. The animation FSM's phase-rate, foot IK, ball physics integrator, crowd-energy ticker, and PostFX vignette ramp all multiplied by that delta and produced a visible jump on the first frame after the stall.

4. **Pitch grass texture was shimmering at glancing angles.**
   1024×512 canvas + anisotropy=8 + ClampToEdge wrapping + no explicit mipmap config → minification picked the wrong MIP at distance and the stripe edges aliased. Mostly cosmetic but contributed to the "field looks unstable" perception.

## Eight fixes shipped

### 1. Match-time `StateFrameBuffer`

`apps/web/lib/replay/state-frame-buffer.ts`. Pure-module ring buffer indexed by spec match-time `t`. Tracks an anchor `(wallMs, matchMs)` and detects bursts vs real-time pacing. `sampleAt(matchMs)` returns:

- linear interpolation on player position (Vec2);
- shortest-arc slerp on player yaw;
- Catmull-Rom across 4 frames for the ball; linear when only 2 bracket.

17 unit tests covering: empty / single-frame / single-pair / 4-frame / clamp-below / clamp-above / out-of-order rejection / capacity eviction / anchor sliding under real-time pacing / anchor *hold* under burst arrival / `currentMatchTime()` advancing at real-time pace.

### 2. Buffer wired through every consumer

`MatchScene` mounts a single buffer via `useStateFrameBuffer(store)` and shares it through `<StateFrameBufferProvider>`. `Player`, `Ball`, `Director`, `CameraRig` consume it via `useSceneBuffer()` and fall back to the legacy `alphaForNow` path when the provider isn't mounted (so unit tests still run with naked component mounts).

### 3. `DampedCameraDriver`

`apps/web/lib/cameras/damped-driver.ts`. Frame-rate-independent damping for the active camera's position, lookAt, and FOV using `THREE.MathUtils.damp`. Snaps on cam cuts (the Director resets it when the cut-blender swaps cams). 6 unit tests covering snap, monotonic-non-overshooting approach, dt-clamp safety on stalls, FOV damping with `updateProjectionMatrix()`, and reset behaviour.

Lambda table:

| Channel    | λ | Half-life @ 60fps |
| ---------- | - | ----------------- |
| Position   | 5 | ~0.14 s           |
| LookAt     | 4 | ~0.17 s           |
| FOV        | 6 | ~0.12 s           |

### 4. dt clamping everywhere

Every `useFrame` clamps `delta = Math.min(deltaRaw, 1/30)` before any integration. Touched: `Player.tsx`, `Ball.tsx`, `Director.tsx`, `CameraRig.tsx`, `Crowd.tsx`, `Stadium.tsx` (GoalNet sway), `PostFX.tsx`.

### 5. Pitch grass shimmer fix

`Pitch.tsx`: 2048×1024 canvas (was 1024×512), softened gradient edges between stripes (was hard step), explicit mipmap config (`generateMipmaps=true`, `LinearMipmapLinearFilter`), anisotropy capped at 4, `ClampToEdgeWrapping` retained. The pitch is parented to scene root (was already; verified).

### 6. Crowd material throttling

`Crowd.tsx`: `mat.color.setHSL(...)` was running every frame. Now throttled to 4 Hz with a hysteresis check (skip if energy delta < 0.01) — saves a uniform re-upload every frame and the per-frame allocation pattern.

### 7. GoalNet sway throttling

`Stadium.tsx`: per-frame `mesh.position.x = sin(...)` write throttled to 5 Hz. Cosmetic gust, not a physics term. Saves a buffer upload per frame.

### 8. Mobile DPR + AA per profile

`MatchScene.tsx`: DPR is now `[1, dprMax]` where `dprMax ∈ {1.0, 1.5, 1.75}` per low/medium/high. Hardware antialias is off on `low` (PostFX still composes from the backbuffer, so the visual difference is small).

PostFX vignette ramp uses `1 - exp(-12 * dt)` instead of a fixed 0.2 factor, so it behaves consistently at any refresh rate and doesn't snap after a frame stall.

## What we did NOT do

- **Did not swap to Soldier.glb** as the body model. The existing rig + animation FSM works; the visible "smooth players" target Tim referenced is delivered by fixing the *position-update* root cause (item 1), not by swapping the mesh. A per-player jerseyed rig is parked in `IDEAS.md` (already there from doc 07) and is a multi-day asset-pipeline task in its own right.
- **Did not touch the crowd sprite atlas, ElevenLabs MP3 batch, or seating GLB**. All parked in `IDEAS.md` from Phase 3 and not on the jitter critical path.
- **Did not modify `packages/spec`**. Spec changes are orchestrator-only.
- **Did not add `<RigidBody>` from `@react-three/rapier`**. Phase-2 substitution still applies (see doc 27b § "Rapier substitution"); the existing `VerletBall` integrator works inside the new buffer pipeline.

## How to verify visually

```bash
pnpm --filter @vtorn/web dev
# open http://localhost:3300/match/fifa-wc-2022-final-arg-fra-2022-12-18
```

What you should see, compared to before:

- Players walk/run/sprint **smoothly** between match-seconds, no per-tick teleport.
- The broadcast camera **eases** to follow the ball — no jerky framing.
- The pitch stripes are **stable** when the camera tilts; no shimmer at distance.
- The HUD score still updates exactly at the canonical AR-FR goal times.

## How to verify mechanically

```bash
pnpm --filter @vtorn/web test       # 432+ tests, including 17 new buffer + 6 driver tests
pnpm --filter @vtorn/web typecheck  # clean
pnpm --filter @vtorn/web lint       # clean (one pre-existing warning unrelated to this PR)
pnpm --filter @vtorn/web build      # clean
```

## Future work (parked)

Promoted to `IDEAS.md`:

- Soldier.glb / hand-modelled body GLB (already in IDEAS as doc-07).
- Real Mixamo-retarget pack (already in IDEAS as doc-07).
- WebGL2 instanced player bodies (would let us push the LOD HIGH bucket count from 22 → ~40 for spectator view).
- Auto-DPR ramp: drop DPR by 0.25 if the rolling 1s-mean frametime > 18 ms; restore when it falls back below 14 ms.
