# Phase 1 — Mocap-quality players (Ready Player Me + Mixamo)

> Replace the procedural-body + billboard-face avatar with a Ready Player Me rigged 3D avatar driven by Mixamo animations through a phase-locked state machine. End state: 22 players running with authority, no foot sliding, no pop transitions.

## Trigger

Run **immediately**. Doesn't depend on any other in-flight phase.

## Branch + PR

- Branch: `feat/fidelity-phase1-mocap`
- PR base: `main`

## Files to create / modify

```
packages/avatar/                        (existing — extend)
  src/
    rpm-loader.ts                       NEW — Ready Player Me GLB loader + cache
    mixamo-pack.ts                      NEW — registry of canonical animation clips
    animation-state-machine.ts          NEW — FSM: idle → walk → jog → sprint → kick → header → tackle → celebrate
    locomotion.ts                       NEW — phase-locked playback rate (no foot slide)
    retarget.ts                         NEW — Mixamo skeleton → RPM bone mapping
  test/
    state-machine.test.ts               NEW — vitest, cover all transitions
    locomotion.test.ts                  NEW — vitest, foot-slide math

apps/web/
  components/Player.tsx                 MODIFY — swap procedural body for RPM avatar
  components/PlayerLOD.tsx              NEW — LOD selector (high/medium/low)
  lib/event-to-action.ts                NEW — map StatsBomb event → state-machine action
  public/assets/avatars/                NEW dir — pre-baked GLBs (22 starters per match)
  public/assets/animations/             NEW dir — Mixamo packs as GLB
  scripts/bake-avatars.mjs              NEW — one-time pre-bake from Wikidata photos → RPM API
  scripts/convert-mixamo.mjs            NEW — FBX → GLB with retargeting
  __tests__/player-state-machine.e2e.spec.ts   NEW — Playwright

docs/
  27a-fidelity-phase1-mocap-rig.md      THIS FILE
```

## Asset pipeline (one-time, runs at build/bake time)

1. **Heads (per player)**:
   - Pull head photo from Wikidata `P18` for each starter Q-id (already done in `face-map.ts`).
   - Send photo to Ready Player Me API: `POST https://models.readyplayer.me/avatar` with photo URL, body type `fullbody`, gender heuristic from FIFA squad metadata.
   - Cache the returned GLB at `apps/web/public/assets/avatars/<player-id>.glb`.
   - Free tier: 1000/month — 22 starters × 2 sides × 2 matches = 88; well within budget.

2. **Animations**:
   - Source: Mixamo's free pack (must download manually via Adobe Mixamo, no API). Required clips:
     - Idle, Walk, Jog Forward, Run Forward, Sprint Forward, Stop Running
     - Soccer Pass, Soccer Kick (instep), Soccer Volley, Soccer Header
     - Slide Tackle, Standing Tackle, Falling, Getting Up
     - Goal Celebration A (knee slide), B (jump), C (point to crowd)
     - Goalkeeper Idle, Dive Left, Dive Right, Catch Above
   - Strip skin from each FBX, keep skeleton + animation.
   - `scripts/convert-mixamo.mjs` retargets Mixamo's bone names to the RPM standard (`mixamorig:Hips` → `Hips` etc.) using `@react-three/utils` retarget helpers.
   - Output: 18 GLBs at `apps/web/public/assets/animations/<clip>.glb`, ~50-200 KB each, ~2 MB total.

## Runtime

### `Player.tsx` rewrite

```ts
// pseudo
function Player({ id, position, velocity, event }) {
  const lod = usePlayerLOD(id, distanceToCamera);
  const avatar = useRPMAvatar(id, lod);          // Suspense load, cached
  const fsm = usePlayerFSM(id);
  fsm.consume(event);                             // event_to_action
  const speed = velocity.length();
  const targetState = fsm.derive(speed, event);
  fsm.transitionTo(targetState);
  fsm.tick(delta, speed);                         // phase-locked playback
  return <PlayerAvatarMesh avatar={avatar} mixer={fsm.mixer} ... />
}
```

### Animation state machine

| State | Enter cond | Exit cond | Crossfade ms | Plays clip |
| --- | --- | --- | --- | --- |
| `idle` | speed < 0.3 m/s for > 200ms | speed > 0.3 | 200 | Idle |
| `walk` | speed 0.3–1.5 | leave window | 150 | Walk |
| `jog` | speed 1.5–3.5 | leave window | 150 | Jog Forward |
| `run` | speed 3.5–6.0 | leave window | 100 | Run Forward |
| `sprint` | speed > 6.0 | speed < 5.5 | 100 | Sprint Forward |
| `pass` | event=Pass | clip ends | 80 | Soccer Pass |
| `kick` | event=Shot | clip ends | 80 | Soccer Kick |
| `header` | event=Shot, body_part=Head | clip ends | 80 | Soccer Header |
| `tackle` | event=Foul (committer side) | clip ends | 100 | Slide Tackle |
| `fallen` | event=Foul (victim side) | 1500ms after | 100 | Falling → Getting Up |
| `celebrate` | event=Shot.outcome=Goal | 4000ms | 200 | Goal Celebration (random) |
| `gk_dive_l`/`gk_dive_r` | GK only, ball on shot trajectory left/right | clip ends | 50 | GK dive |

### Phase-locked locomotion

The "no foot sliding" trick:

```
animSpeed = clipDuration / clipMetersPerCycle
playbackRate = velocityMagnitude / animSpeed
```

Result: when player moves at 5 m/s and the run clip's natural speed is 4 m/s, mixer plays at 1.25x. Feet stay planted relative to ground.

### LOD strategy

| LOD | Distance from camera | Polys | Animation | Used for |
| --- | --- | --- | --- | --- |
| HIGH | < 15 m | RPM full (~12k) | full FSM | 3-4 cam-focused players |
| MED | 15–35 m | RPM medium (~6k via simplification) | reduced FSM (no kick variants) | nearby players |
| LOW | > 35 m | low-poly stand-in (~1.5k) | walk + run only | far players |

LOD swap is async: triggered when player crosses threshold, the new mesh loads, mixer state copies over, old mesh disposes.

## Testing

### Unit (vitest)
- `state-machine.test.ts`: cover every transition. Use a synthetic event stream.
- `locomotion.test.ts`: assert foot-slide < 0.05 m/s drift over 30 s of synthetic velocity changes.

### Playwright E2E (`__tests__/player-state-machine.e2e.spec.ts`)
1. Navigate to `/match/fifa-wc-2022-final-arg-fra-2022-12-18?time-scale=10&seed-state=t-22m`.
2. Wait for canvas + 22 players loaded.
3. Assert no console errors.
4. Scrub timeline to 22:30 (just before Messi pen).
5. Take screenshot, save to `test-fixtures/visual/phase1-pre-messi-pen.png`.
6. Scrub to 23:30 (after goal).
7. Assert FPS counter (window.__vtornFps) > 50 over the prior 1 second.
8. Take screenshot of celebration.

### Visual review
Save 3 PNG snapshots in PR body for human review.

## Acceptance criteria (PR will block on these)

- [x] All 22 players are 3D rigged avatars (no billboard faces during normal play; billboards may stay as fallback for unknown subs).
- [x] Players run, sprint, kick, header, tackle with appropriate animation.
- [x] No foot sliding visible in goal celebration replays.
- [x] No animation pop on transitions.
- [x] 60fps on Pixel 7a profile (use Playwright's `--device="Pixel 7"` and assert frame budget).
- [x] Bundle size delta to apps/web < 3 MB (gzipped).
- [x] All vitest + Playwright tests pass.
- [x] CI green.

## Rollback

If RPM API has rate-limit issues at runtime, fall back to billboard face on the existing procedural body. The Player component reads `useFeatureFlag('avatar.rpm')` and short-circuits to billboard if disabled.

## Performance gates

If any of the following fails on the Playwright Pixel 7 profile, the PR is blocked:
- Median frame time > 16.7ms during steady-state play.
- Memory > 350 MB.
- Total network > 50 MB for the match-load.

## Out of scope (these go to Phase 2 or later)

- Foot IK to ground plane (Phase 2).
- Ball physics (Phase 2).
- Camera director (Phase 2).
- Crowd, stadium tier geometry (Phase 3).
- Post-processing (Phase 3).
- Magnus curve, sweat normals, replay HUD (Phase 4).
