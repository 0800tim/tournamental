# 04, Reference Renderer (Next.js + React Three Fiber)

> The default browser renderer. Subscribes to a spec stream, reconstructs the scene, draws it. This is one of many possible consumers; it's the one shipped in the repo and the one we polish first.

## Stack

- **Next.js 14, app router, TypeScript.** Server-rendered shell, client-rendered scene.
- **React Three Fiber + drei + three.js.** WebGL via React. Mainstream, well-documented, easiest target for forks.
- **Zustand** for the live match store. Lightweight, ref-friendly, no Context re-renders.
- **`packages/spec-client` (workspace package)** holds the WebSocket + chunk client and exports a single `useMatchStream(url)` hook. Forks reuse this verbatim.
- **No global state libraries beyond Zustand.** No Redux, no React Query for the live stream, the volume is too high for normal cache invalidation.

Why Next.js and not pure Vite? Because Next gives us routing for `/match/[id]`, `/replay/[id]?t=...`, OG image generation for share cards, and a clean place to add server endpoints later (a small REST surface for "list active matches", auth tokens, etc.). The 3D scene itself is a `'use client'` component; SSR doesn't touch WebGL.

## File layout

```
apps/web/
├── app/
│   ├── layout.tsx                root layout, fonts, html
│   ├── page.tsx                  landing, picks demo match
│   ├── match/[id]/page.tsx       loads init, mounts <MatchScene/>
│   └── replay/[id]/page.tsx      same scene, archive manifest
├── components/
│   ├── MatchScene.tsx            top-level R3F <Canvas>; cameras, lights
│   ├── Pitch.tsx                 procedural pitch + line markings
│   ├── Stadium.tsx               stand walls, crowd sprite, sky dome
│   ├── Player.tsx                avatar + jersey + nameplate
│   ├── Ball.tsx                  sphere with subtle rotation
│   ├── HUD.tsx                   2D overlay: score, clock, ticker
│   ├── CameraRig.tsx             follow-ball / broadcast / top-down
│   └── DebugPanel.tsx            stream lag, fps, current state size
├── lib/
│   ├── store.ts                  Zustand match store
│   ├── interpolation.ts          lerp between StateFrames
│   ├── animation-fsm.ts          per-player anim state machine
│   ├── jersey-texture.ts         canvas → THREE.Texture
│   └── coords.ts                 spec coords ↔ three.js world
├── public/
│   ├── models/                   GLB avatars, ball, etc.
│   └── animations/               retargetable Mixamo FBX/GLB
├── package.json
└── next.config.mjs
```

## Coordinate mapping

Spec coords are pitch-centred metres with +x along length, +y along width, +z up. Three.js convention is +y up. Map at the boundary, not throughout the codebase. `lib/coords.ts`:

```ts
import type { Vec2, Vec3 } from "@simsports/spec";
import { Vector3 } from "three";

/** Spec [x, y]   →  three.js (x, 0, -y).  +z(spec) is +y(three). */
export const toWorld = (p: Vec2 | Vec3): Vector3 =>
  p.length === 2
    ? new Vector3(p[0], 0, -p[1])
    : new Vector3(p[0], p[2], -p[1]);

export const toWorldYaw = (yaw: number): number => -yaw; // x→+x, y→-z flips sign
```

This is the only place in the renderer that knows the spec's coordinate convention. Every component takes `Vector3` and is conventional three.js.

## Stream consumption and store

`useMatchStream(url)` returns a Zustand store:

```ts
type MatchStore = {
  init: MatchInit | null;
  // The two most recent state frames, for lerp.
  prev: StateFrame | null;
  curr: StateFrame | null;
  // Recent events, ring buffer of ~64. Renderers consume these as one-shots.
  events: EventMessage[];
  // Latency telemetry.
  lagMs: number;
};
```

The hook opens either a WebSocket (live mode) or fetches `live.m3u8` and walks chunks (CDN mode). On every incoming `state` message it shifts `curr → prev` and writes the new one to `curr`. On every `event.*` it pushes onto the ring buffer with a TTL.

## Interpolation

The renderer ships **two** interpolation paths. They live behind the same store but the buffer-mode path is the default for the AR-FR demo and any source that batches frames.

### Wall-clock alpha (legacy 2-frame, default fallback)

Each render frame, the scene knows wall-clock `now` and the `prev / curr` pair with timestamps `t_prev_wall` and `t_curr_wall`. Compute:

```ts
const alpha = clamp01((now - t_prev_wall) / (t_curr_wall - t_prev_wall));
```

For each player and the ball, `pos = lerp(prev.pos, curr.pos, alpha)` and `facing = slerpAngle(...)`. Updating mesh `position` and `rotation` directly (via refs) avoids React re-renders at 60+ fps. The standard R3F pattern:

```tsx
function Player({ id }: { id: string }) {
  const meshRef = useRef<Group>(null!);
  useFrame(() => {
    const s = computePlayerState(id); // reads from store, lerps
    meshRef.current.position.copy(toWorld(s.pos));
    meshRef.current.rotation.y = toWorldYaw(s.facing);
  });
  return <group ref={meshRef}>{/* avatar mesh */}</group>;
}
```

If the network drops a frame and `t_curr` becomes stale, extrapolate using ball `vel` for ~200ms before holding.

### Match-time `StateFrameBuffer` (preferred)

The wall-clock alpha works for clean live streams with one frame per arrival. It breaks down when a source *batches* frames into a single tick (e.g. the synthetic AR-FR producer paces ~7300 messages four-per-tick, so multiple state frames stamp the store with the *same* `Date.now()`, alpha saturates at 1, and the renderer snaps).

`apps/web/lib/replay/state-frame-buffer.ts` solves that with a small ring buffer keyed by *match-time* `t` plus an anchor `(wallMs, matchMs)`. Each render frame computes `currentMatchTime = anchor.matchMs + (wallNow - anchor.wallMs)` and `sampleAt(currentMatchTime)` returns:

- linear interpolation on player position;
- shortest-arc slerp on player yaw;
- Catmull-Rom across 4 frames for the ball trajectory (linear when only 2 frames bracket).

The buffer detects bursts (more match-time advance than wall-clock advance) and *holds* the anchor in place, the renderer reads forward at real-time pace and naturally interpolates between buffered frames as wall-clock advances.

`MatchScene` mounts a single `StateFrameBuffer` via `useStateFrameBuffer(store)` and shares it through `<StateFrameBufferProvider>`. `Player`, `Ball`, `Director`, and `CameraRig` consume it via `useSceneBuffer()` and fall back to the wall-clock alpha when the provider isn't mounted (keeps unit tests / direct mounts working).

| Source kind                                  | Path used                          |
| -------------------------------------------- | ---------------------------------- |
| Synthetic in-process producer (AR-FR demo)   | StateFrameBuffer (default)         |
| Manifest replay (`*.ndjson` / `.gz`)         | StateFrameBuffer + ManifestController seek |
| Live WebSocket (real producer)               | StateFrameBuffer (graceful for any cadence) |
| Unit tests / direct R3F mount without provider | Legacy wall-clock alpha          |

## Animation state machine

`lib/animation-fsm.ts`. One FSM per player. Inputs every frame: `(speed, facing_delta, current_event_for_this_player)`. Output: an animation tag plus a one-shot trigger queue.

```
   idle ──speed>0.5──▶ walk ──speed>2.5──▶ run ──speed>5──▶ sprint
     ▲                  │                   │                │
     └──speed<0.2───────┴───────────────────┴────────────────┘

   any  ──event.pass(self)──▶  one-shot: pass    (~0.4s, blends back)
   any  ──event.shot(self)──▶  one-shot: shoot   (~0.6s)
   any  ──event.tackle(self)─▶ one-shot: tackle  (~0.8s)
   any  ──event.goal(self)──▶  one-shot: celebrate (~3.0s, sticky)
   any  ──event.foul(victim:self)─▶ one-shot: fall (~1.0s)
```

For the v0.1 procedural avatar (see [docs/07-avatars-and-assets.md](07-avatars-and-assets.md)), "animation" is mostly a tag that drives a small position/rotation offset on the limbs (tilted body for run, swinging legs for kick), full skeletal animation only kicks in when GLB avatars are loaded.

## Camera modes

`CameraRig.tsx` exposes three manual modes plus the auto-`Director` (default):

- **Director (default).** `components/Director.tsx` runs an FSM over four virtual cams, broadcast / behind-goal / player-track / goal-replay, and switches on goal events.
- **Broadcast.** Tracks the ball with a smoothed offset, similar to a TV main camera. Slight zoom-out during set-pieces.
- **Follow-ball-tight.** Closer, lower, dramatic. Good for short clips.
- **Top-down tactical.** Ortho camera, plan view, lower frame budget. Used by analyst-style forks.

### Damped camera writes

Both the manual `CameraRig` and the `Director` route their final write through `lib/cameras/damped-driver.ts`. The damper:

- Tracks `(position, lookAt, fov)` independently with `THREE.MathUtils.damp`.
- Frame-rate-independent: `damp(current, target, lambda, dt)` so a 30fps frame and a 144fps frame converge over the same wall-clock duration.
- Clamps `dt` to ≤ 1/30 s internally so a stall or tab-switch doesn't snap the camera.
- Snaps on cuts (the Director resets the damper when `cutBlender.evaluate().name` changes; the cut-blender's eased intra-segment transition still drives the visible "cut" effect over 200-400 ms).

| Channel      | Lambda  | Notes                                                                |
| ------------ | ------- | -------------------------------------------------------------------- |
| `position`   | 5       | Reaches half the gap in ≈ 0.14 s. Smooth on the eye, not laggy.      |
| `lookAt`     | 4       | Slightly slower so the camera's framing feels stable when the ball jukes. |
| `fov`        | 6       | Tighter so set-piece zoom-outs feel deliberate.                      |

This is what turned the broadcast follow from "snaps per state-frame" into "smooth tracking". The cut-blender already eased *transitions between cams*, but the *target itself* (e.g. broadcast's `lookAt = ball.position * 0.4`) moves discontinuously per state frame, and without the damper the camera was snapping with it.

## HUD

A standard 2D React overlay with `pointer-events: none` over the canvas. Reads from the same store. Score, clock, latest commentary line, latest event banner ("GOAL, Blue 1, Red 0").

For TTS commentary playback, an `Audio` element pool consumes `event.commentary` messages with `voice_id`. ElevenLabs (or local TTS) is invoked server-side when the producer emits the commentary; the resulting audio URL goes in the event payload (extension field, not yet in spec, propose `audio_uri` for v0.2).

## Performance budget

Target: 60 fps steady state, 30 fps minimum during goal-celebration spikes, on a mid-range 2022 Android. Concretely:

- ≤ ~30 skinned characters on screen (22 players + crowd LOD via sprites only).
- Procedural pitch is a single mesh with a baked 2048×1024 striped grass texture (mipmapped to suppress shimmer at glancing angles); lines are flat geometry not strokes.
- Stadium is a low-poly bowl with a billboarded crowd ring. No per-spectator geometry.
- Shadows: one directional light with PCF soft shadows. Shadow-map size is profile-driven (1024 / 2048 / 4096 for low / medium / high).
- Post-processing: gated on quality preset. `?fx=off` URL flag bypasses the EffectComposer entirely; `?quality=low` ships bloom + vignette only.
- Crowd colour writes throttled to 4 Hz with hysteresis. Goal-net wind sway throttled to 5 Hz.
- All `useFrame` callbacks clamp `delta` to ≤ 1/30 s so a tab-stall doesn't produce a visible jump in animation phase, ball physics, or camera position.

### Mobile DPR + AA

`MatchScene` resolves the quality profile once at mount and caps device pixel ratio:

| Preset  | DPR cap | Hardware AA | Bloom | Shadow map | SSAO       | Motion blur |
| ------- | ------- | ----------- | ----- | ---------- | ---------- | ----------- |
| low     | 1.0     | off         | min   | 1024²      | off        | off         |
| medium  | 1.5     | on          | on    | 2048²      | on (light) | off         |
| high    | 1.75    | on          | on    | 4096²      | on (full)  | on          |

Frametime budget on medium: 16.6ms total → 4ms scene update, 8ms draw, 4ms slack. Profile with `r3f-perf` during dev.

## Acceptance criteria for v0.1

- [ ] Connects to a live socket and a CDN manifest URL via the same hook.
- [ ] Renders all 22 players + ball + pitch + minimal stadium at 60fps on M1 / mid-range Android.
- [ ] Lerp between state frames is smooth even at 10Hz input.
- [ ] Animation FSM correctly transitions idle/walk/run/sprint by speed.
- [ ] One-shot animations fire on `event.pass`, `event.shot`, `event.tackle`, `event.goal`.
- [ ] HUD shows score, clock, commentary ticker, latest event banner.
- [ ] Camera mode toggle (broadcast / top-down) works.
- [ ] DebugPanel shows lag, fps, last state `t`, frame count.

## What's out of scope for v0.1

- VR/AR (WebXR, fold in later, scene is already in three.js so it's an additive lift).
- Crowd cheers / ambient audio (separate from commentary; needs an asset pack).
- In-scene replay (snap to event time).
- Spectator chat / Twitch overlay.
- Stadium customisation per-team.
