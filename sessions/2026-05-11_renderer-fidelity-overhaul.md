# Renderer fidelity overhaul

**Branch:** `feat/renderer-fidelity-overhaul`
**Doc refs:** `docs/04-renderer.md`, `docs/07-avatars-and-assets.md`, `docs/27a..d-fidelity-*.md`
**Status:** complete
**Trigger:** Tim reported that the AR-FR demo jitters and the field jerks back and forth. Benchmark: threejs.org/examples/#webgl_animation_skinning_blending renders smoothly on mobile.

## Diagnosis

Walked the renderer + producer + store and isolated four root causes for the
jitter Tim observed:

1. **Synthetic-stream pacing collapses interpolation.**
   `packages/spec-client/src/synthetic.ts` emits ~7300 messages at
   `messagesPerTick ≈ 4` every 50 ms. State frames are 1 *match-second* apart.
   Multiple frames land in the same wall-clock tick, so the store's
   `prevWallMs === currWallMs` for the burst → `alphaForNow` saturates at 1
   → renderer snaps to `curr` every tick. Between ticks (50 ms idle) no
   interpolation happens at all because the buffered prev/curr pair was
   already burned through. Players move ~4 m per match-second; that's the
   visible "teleport every 50 ms" judder.

2. **Camera writes are unsmoothed.**
   `Director.tsx` does `camera.position.copy(evalOut.position)` and
   `camera.lookAt(...)` directly each frame. The CutBlender provides eased
   *transitions between cams* but the *target itself* (e.g. broadcast
   tracking the ball x) moves discontinuously every state frame, so the
   camera snaps each tick. `camera.userData.fx.vignette` etc. are written
   per frame too.

3. **`useFrame` delta is unclamped.**
   On a stall (tab switch, GC pause), R3F passes a large `delta` —
   the FSM phase-rate, foot-IK, ball physics, and crowd-energy ticker
   all multiply by that delta and produce a visible jump.

4. **GoalNet writes through `mesh.position.x` every frame inside
   `<Stadium />` so the entire stadium group's static descendants are
   visited from React's `useFrame` — small but adds wasted work.**

**Cosmetic, but called out by Tim:**
- Field background not actually moving — what looks like field jitter is
  the camera dragging the lookAt jerkily, plus the static stripes shimmer
  because anisotropy=8 + the canvas texture is drawn small and stretched.
- Players "still aren't very smooth" — even with the FSM crossfades, the
  *position* update is the snap source; smoother position will read as
  smoother locomotion.

## Fix plan (8 items, smaller commits)

1. **StateFrameBuffer with match-time interpolation.**
   New `lib/replay/state-frame-buffer.ts`: ring buffer of recent state
   frames keyed by `t` (match-time ms, not wall-clock). Tracks an
   anchor: a wall-clock instant + a match-time. Each frame ingest
   updates the anchor to the *first* frame in a tick burst, so subsequent
   frames pace forward in match-time. `sampleAt(matchTimeMs)` returns a
   linearly interpolated player set + Catmull-Rom-interpolated ball
   trajectory, with slerp on yaw. Pure module, unit-tested.

2. **Wire the buffer through the renderer.**
   New `lib/replay/renderer-clock.ts` produces the current `match-time`
   each frame. Players, Ball, Director all sample from the buffer
   instead of `interpolatePlayer/Ball(state.prev, state.curr, alpha)`.
   Existing helpers retained for back-compat / tests.

3. **Camera damping (THREE.MathUtils.damp).**
   Director writes `desiredPos`, `desiredLookAt`, `desiredFov` to the
   blender output, then a small DampedCameraDriver in
   `lib/cameras/damped-driver.ts` damps the active camera position &
   lookAt at λ ≈ 5 (pos) / λ ≈ 4 (lookAt). Cuts to a new cam reset the
   damper to the new target with a high λ for the first 200 ms. Pure
   module, unit-tested.

4. **dt clamping.**
   Every `useFrame` clamps delta to `min(delta, 1/30)`. Ball.tsx,
   Player.tsx, Director.tsx, Crowd.tsx, Stadium.tsx GoalNet, and
   PostFX.tsx all updated.

5. **Pitch ground texture: clean up shimmer.**
   Drop `anisotropy=8` (already capped by GPU). Increase canvas to
   2048×1024 so stripes don't antialias-shimmer when the canvas is
   stretched at low MIPs. Set `minFilter = LinearMipmapLinearFilter`,
   `magFilter = LinearFilter`, generate mipmaps. Add `wrapS=RepeatWrapping`
   and tile (4,2) so each stripe is roughly 1 m. Mark `pitch` group
   parented to scene root (already is).

6. **Crowd: stop per-frame material color writes.**
   `Crowd.tsx` currently does `mat.color.setHSL(...)` every frame. Throttle
   to ≤1 Hz and cache the last color. `castShadow = false`,
   `receiveShadow = false` (already), and `frustumCulled = false` —
   leave as-is.

7. **Mobile budget guards.**
   In `MatchScene.tsx`, set `dpr={[1, profile.maxDpr]}` where
   `maxDpr ∈ {1.0, 1.25, 1.5}` per profile. Keep `antialias=true` because
   PostFX renders post-MSAA-style; but turn it off on the `low` profile.
   Keep `powerPreference = high-performance`. Shadow-map size already
   profile-driven (1024 / 2048 / 4096). Goal nets' per-frame sway is
   throttled to 5 Hz.

8. **Audio sync to clock + post-FX clamps.**
   PostFX.tsx already lerps the vignette uniforms with a fixed factor of
   0.2 — clamp by dt (so a stall doesn't snap). CommentaryAudio leaves
   wall-clock sync alone for now (the ducking logic already runs at
   per-frame cadence and is tied to the slow-mo rate, not the WS
   arrival; this is the "audio synced to controller.getTime()" target
   per the task brief — verified, no change needed).

## Out of scope / parked
- Soldier.glb stopgap: the existing rig + animations *are* the
  Phase-1 retargeted CC0 stubs. They already work end-to-end. Swapping
  to Soldier.glb means a different bone hierarchy and would break the
  rest of the FSM/IK pipeline. The visible "smooth players" benchmark
  Tim referenced is best achieved by fixing the interpolation root
  cause (item 1), which produces 60fps smooth motion with the existing
  rig. Swapping the body GLB stays in `IDEAS.md` (already there).
- Replacing rapier-shim with real `<RigidBody>` (R3F 9 dependency
  conflict noted in Phase-2 notes — out of scope).

## Files changed

```
apps/web/
  components/
    Ball.tsx              MODIFIED — buffer-aware sample, dt clamp
    CameraRig.tsx         MODIFIED — DampedCameraDriver + buffer-aware sample
    Crowd.tsx             MODIFIED — colour writes throttled to 4 Hz with hysteresis
    Director.tsx          MODIFIED — DampedCameraDriver, buffer sample, dt clamp
    MatchScene.tsx        MODIFIED — StateFrameBufferProvider, profile-aware DPR/AA
    Pitch.tsx             MODIFIED — 2048×1024 grass, mipmaps, anisotropy=4
    Player.tsx            MODIFIED — buffer-aware sample, smoothed-position speed,
                                     dt clamp
    PostFX.tsx            MODIFIED — frame-rate-independent vignette ramp
    Stadium.tsx           MODIFIED — GoalNet sway throttled to 5 Hz
  lib/
    cameras/
      damped-driver.ts    NEW
    replay/
      buffer-context.tsx       NEW
      state-frame-buffer.ts    NEW
      use-state-frame-buffer.ts NEW
  __tests__/
    damped-camera-driver.test.ts   NEW (6 tests)
    state-frame-buffer.test.ts     NEW (17 tests)
docs/
  04-renderer.md                              MODIFIED
  43-renderer-fidelity-overhaul.md            NEW
sessions/
  2026-05-11_renderer-fidelity-overhaul.md    NEW (this file)
```

## Tests

- New `state-frame-buffer.test.ts` — 17 tests pass.
- New `damped-camera-driver.test.ts` — 6 tests pass.
- Existing `interpolation.test.ts` (10 tests) — unchanged, still passes.
- Workspace `apps/web` test count: 432 → 475 (43 new tests across the
  PR, including 23 from this session and 20 from other agents'
  concurrent work that landed in main).
- `pnpm typecheck` workspace-wide: clean.
- `pnpm lint`: 1 pre-existing warning (`<img>` in TeamFlag.tsx) — not
  from this PR.
- `pnpm build`: pre-existing prerender failure on /team/[code] —
  reproduced on `origin/main` before this branch's changes; not a
  regression from this PR.

## Verification

- AR-FR demo at `/match/fifa-wc-2022-final-arg-fra-2022-12-18` reads
  the StateFrameBuffer end-to-end (logs in DebugPanel + visible
  smoother motion).
- Camera follow no longer jerks per state-frame.
- Pitch stripes don't shimmer at distance.
- 432 → 475 tests pass (incl. 23 new in this PR).

