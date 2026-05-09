# Phase 2 — Physics + auto-director

> Plant feet on the ground with IK. Replace position interpolation with a physics-driven ball. Build an event-driven camera director that switches angles + slow-mos goals.

## Trigger

Phase 1 PR merged into `main`.

## Branch

`feat/fidelity-phase2-physics-director`

## Files to create / modify

```
packages/avatar/
  src/
    foot-ik.ts                          NEW — two-bone IK solver, foot to ground raycast
  test/
    foot-ik.test.ts                     NEW

packages/ball-physics/                  NEW workspace package
  package.json
  src/
    index.ts
    ball-spline.ts                      NEW — Catmull-Rom + ease-out for passes/shots
    ball-rapier.ts                      NEW — Rapier rigid-body for free kicks, contact moments
    magnus.ts                           NEW — curl-effect modifier (Phase 4 fully realises this)
  test/
    ball-trajectory.test.ts             NEW

apps/web/
  components/Ball.tsx                   MODIFY — read from BallPhysics not interpolation
  components/Director.tsx               NEW — virtual camera + auto-cut on events
  lib/cameras/
    broadcast-cam.ts                    NEW — wide tracking camera
    behind-goal-cam.ts                  NEW
    player-track-cam.ts                 NEW
    goal-replay-cam.ts                  NEW — slow-mo, vignette boost
  lib/director/
    director-policy.ts                  NEW — listens to event stream, decides cuts
    replay-buffer.ts                    NEW — circular buffer of last 10s of player+ball positions
    cut-blender.ts                      NEW — eased camera transitions
  app/match/[id]/page.tsx               MODIFY — wire <Director> into MatchScene
  __tests__/director.spec.ts            NEW — playwright

docs/
  27b-fidelity-phase2-physics-director.md   THIS FILE
```

## Foot IK

Two-bone IK per leg (hip → knee → ankle), solved each frame:

1. Raycast from hip down through knee+ankle bone at world Y.
2. Find ground intersection.
3. If stance phase (foot animation says foot is planted), pin foot bone to intersection point (lock).
4. If swing phase, blend off the lock.

Library: `three-ik` is OK but heavy. Custom solver fits in ~80 lines for two-bone case. Use the Mixamo "is-stance" hint baked into clip metadata at convert time.

## Ball physics

Two modes, switched per event:

### Spline mode (default)
- For passes and shots with known start + end positions and known apex (computed from initial speed + arc).
- Catmull-Rom through (start, apex, end), 60Hz interpolation.
- Cheap: 0 physics overhead.
- 95% of ball motion uses this.

### Rapier mode (corner kicks, free kicks, deflections, post hits)
- `@react-three/rapier`'s `<RigidBody>` for the ball with mass 0.43 kg, restitution 0.6, friction 0.4.
- Trigger when event is `Free Kick` or when prior shot has `outcome=post|crossbar` (for the rebound).
- After 2 seconds of physics OR when the next deterministic event fires, switch back to spline mode and reconcile to the next known position.

### Magnus (preview, full realisation in Phase 4)
- For free kicks and curling shots, modify the spline by adding a side-force vector orthogonal to the direction of travel. Magnitude proportional to assumed spin (constant for Phase 2).

## Auto-director

The director watches the event stream and decides which camera to show, when to cut, when to slow-mo.

### Camera registry

| Cam | When | Settings |
| --- | --- | --- |
| `broadcast` | Default | 70mm equiv FOV, 25 m above pitch level, follows ball x with damping |
| `behind-goal` | Goal slow-mo, big shots | 50mm FOV, 8 m up, behind goal, looks at ball |
| `player-track` | Long runs (Mbappé sprint), penalty walk-up | 35mm FOV, 4 m behind player, looks over shoulder |
| `goal-replay` | Goal scored, replay 4-second window | 0.25× speed, vignette 0.6, motion blur up |

### Director policy

```
on event:
  case Goal:
    pause live → record replay buffer (last 8s)
    cut to behind-goal cam, play replay buffer at 0.25× with goal-replay post FX
    after replay: cut to player-track on scorer for celebration animation
    after 5s celebration: ease back to broadcast
    fire commentary cue: replay-window-start + replay-window-end (so audio mixer can duck)
  case Penalty taken:
    cut to behind-goal cam 1s before kick, hold to outcome
  case Shot blocked / saved:
    no cut, broadcast continues
  case Substitution:
    ribbon banner overlay (HUD), no cam change
```

### Cut blender

Camera cuts are not instant. They use a 200-400ms ease (cosine) on position + lookAt, unless the cut is to `goal-replay` (instant for impact).

### Replay buffer

Circular buffer holds the last 10 seconds of `{playersPosArray, ballPos, time}` at 60Hz. ~36 KB. On goal, the renderer plays back this buffer through the mixer at 0.25×, post-FX boosted.

## Tests

### Unit
- `foot-ik.test.ts`: synthetic skeleton + ground plane; assert foot Y matches plane Y to ±2 cm.
- `ball-trajectory.test.ts`: spline mode passes through known apex within 1% error.
- `director-policy.test.ts`: replay event log, assert correct cut sequence.

### Playwright (`director.spec.ts`)
1. Open `/match/fifa-wc-2022-final-arg-fra-2022-12-18?time-scale=10&seed-state=t-22m45s`.
2. Wait for Messi pen at 23'.
3. Assert camera goes to `behind-goal` ~1s before kick.
4. Assert post-goal: cut to `goal-replay` at 0.25× speed.
5. Assert FPS counter never drops below 30 during the slow-mo (slow-mo runs at logical 0.25× but we still render real-time frames).
6. Save screenshots at goal moment + replay moment.

## Acceptance criteria

- [x] Players' feet stay on ground plane through goal celebrations and slide tackles. No skating.
- [x] Ball arcs naturally on shots; goal kicks bounce realistically.
- [x] On every goal, camera switches angle, slow-mos, and returns to broadcast.
- [x] Commentary (Phase 0 transcript or live ElevenLabs from Phase 3) sync stays within ±150 ms of replay timeline.
- [x] 60fps held on Pixel 7a Playwright profile.
- [x] All tests pass.

## Performance budget

- IK per player: < 0.05 ms. 22 players × 2 legs = < 2.2 ms / frame, well inside budget.
- Rapier ball: < 1 ms / step, only active during free kick windows.
- Director update: < 0.1 ms / frame.

## Out of scope

- Crowd, stadium geometry (Phase 3).
- Post-processing stack (Phase 3).
- Realtime ElevenLabs WS streaming (Phase 3).
- Magnus full curl tuning, sweat normals, replay HUD (Phase 4).
