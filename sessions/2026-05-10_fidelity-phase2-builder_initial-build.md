# Phase-2 fidelity build

- **Branch**: `feat/fidelity-phase2-physics-director`
- **Spec**: `docs/27b-fidelity-phase2-physics-director.md`
- **Trigger**: Phase 1 PR #45 merged into `main`.
- **Status**: complete; all unit + integration tests pass.

## Plan

1. `packages/avatar/src/foot-ik.ts` — two-bone IK + stance schedule.
2. `packages/ball-physics/` — new workspace package with spline + Rapier
   (with Verlet fallback) + Magnus modules.
3. `apps/web/components/Director.tsx` — auto-director with replay buffer
   + cut blender + 4 virtual cameras.
4. `apps/web/lib/cameras/{broadcast,behind-goal,player-track,goal-replay}.ts`
   — pure pose computation per camera.
5. `apps/web/lib/director/{director-policy,replay-buffer,cut-blender}.ts`
   — pure logic for the FSM, the buffer, and eased transitions.
6. Wire into `MatchScene.tsx`, `Ball.tsx`, `Player.tsx`.
7. Tests: foot-ik (15), ball-trajectory (15), ball-rapier (11),
   director-policy (16), Playwright e2e (`director.e2e.spec.ts`).

## Decisions

- **Foot IK is analytic 2-bone** with a knee-pole derived from the
  rest-pose so we get a stable bend direction across diverse rigs.
  World-space delta quaternions are converted back to local via the
  hip parent's current world rotation; this avoids the
  rest-pose-frame drift that the first iteration hit.
- **Ball-physics is a workspace package** so the spec/types stay
  shared with the renderer. The `BallController` owns the
  spline↔rapier mode switch + 2 s rapier timer.
- **Rapier substitution**: `@react-three/rapier@2.x` requires R3F 9 /
  React 19, which conflicts with the renderer's R3F 8 / React 18 stack
  inherited from Phase 1. Per the spec's substitution clause we ship
  a `VerletBall` integrator with the same `BallPhysicsAPI` surface;
  swapping in a real `<RigidBody>` is a one-day swap when the
  renderer upgrades to R3F 9.
- **Director defaults on**: `MatchScene`'s default camera mode is now
  `director` (auto-cut on goals). Manual broadcast/tactical/follow
  remain available via the toggle.
- **PerfMonitor exposes director state** to the DOM via
  `.perf-monitor[data-cam][data-rate][data-fps]` so the Playwright
  spec can sample without reaching into R3F internals.

## Tests

- `packages/avatar/test/foot-ik.test.ts` — 15 tests, all passing.
- `packages/ball-physics/test/ball-trajectory.test.ts` — 15 tests.
- `packages/ball-physics/test/ball-rapier.test.ts` — 11 tests.
- `apps/web/lib/director/test/director-policy.test.ts` — 16 tests.
- `apps/web/__tests__/e2e/director.e2e.spec.ts` — Playwright; gated on
  `VTORN_RUN_DIRECTOR_E2E=1` because it needs a running dev server +
  the manifest replay file. Boot with `VTORN_AUTOSTART_DEV=1` to have
  Playwright start the dev server.

Total Phase-2 new tests: **57**.
Total monorepo passing: **420** (was 363 before Phase-2).

## Open questions / Phase-3 hand-off

- The director writes `camera.userData.fx` / `slowMoRate` — Phase 3's
  PostFX stack reads these to drive vignette + motion-blur during
  goal replays.
- The replay buffer holds last 10 s of `{ball, players}`; Phase 3's
  CommentaryAudio reads `policy.cutAtMs()` + `replaySec` to duck
  commentary during the slow-mo window.
- Foot IK's stance schedule is the default symmetric out-of-phase
  cycle. Phase 4 can swap in clip-baked stance metadata for
  higher-fidelity heel-strike / toe-off blending.

## Next steps

- Open PR; reviewer agent runs the verification checklist.
- After merge, Phase 3 (`agent: fidelity-phase3`) boots — see
  `docs/27c-fidelity-phase3-stadium-crowd.md`.
