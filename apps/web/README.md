# @vtorn/web

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 2. See [docs/04-renderer.md](../../docs/04-renderer.md).

Next.js 14 + React Three Fiber renderer. Connects to a producer's spec stream
(e.g. [`apps/statsbomb-replay`](../statsbomb-replay/) for the AR-FR 2022 demo,
or [`apps/mock-producer`](../mock-producer/) for synthetic data) and renders
pitch + 22 procedural-avatar players + ball + HUD.

## Routes

- `/`, landing page placeholder linking to the demo.
- `/match/[id]`, main demo route. Mounts the 3D scene against a live
  producer URL (default `ws://localhost:4001`) or the bundled in-process
  synthetic AR-FR fixture (`?src=synthetic`).
- `/replay/[id]`, same scene against an archive manifest URL via `?src=...`,
  defaulting to the synthetic AR-FR fixture.

## Run

```bash
pnpm install                                        # from repo root
pnpm --filter @vtorn/web dev
# open http://localhost:3000/match/fifa-wc-2022-final-arg-fra-2022-12-18
```

The demo route boots against the in-process synthetic stream by default, no
producer required to verify the renderer end-to-end.

To attach to a real producer:

```bash
NEXT_PUBLIC_VTORN_WS_URL=ws://localhost:4001 pnpm --filter @vtorn/web dev
# or
open "http://localhost:3000/match/<id>?src=ws://localhost:4001"
```

## Components

- `MatchScene`, top-level R3F `<Canvas>`; cameras, lights, mounts.
- `Pitch`, procedural pitch + line markings.
- `Stadium`, low-poly bowl ring + crowd colour band.
- `Player`, capsule + jersey texture + nameplate; FSM-driven motion.
- `Ball`, sphere with lerp + velocity extrapolation when stale.
- `HUD`, 2D overlay (score, clock, shootout panel, event banner, commentary).
- `CameraRig`, broadcast / top-down / follow-ball-tight modes.
- `DebugPanel`, fps, lag, last state `t`, frame count.
- `OddsHUD`, placeholder for historic-odds widget; reads
  `public/data/wc2022-final-odds.json` if present, renders nothing if not.

## Library helpers (unit-tested)

- `lib/coords.ts`, spec coords ↔ three.js coords.
- `lib/interpolation.ts`, lerp / slerp / extrapolate / speed estimation.
- `lib/animation-fsm.ts`, locomotion + one-shot animation state machine.
- `lib/jersey-texture.ts`, per-player canvas texture (cached).
- `lib/store.ts`, thin renderer-side wrapper around `@vtorn/spec-client`.

## Tests

```bash
pnpm --filter @vtorn/web test         # vitest, jsdom env
pnpm --filter @vtorn/web typecheck
pnpm --filter @vtorn/web lint
```

## Spec contract

Consumes `@vtorn/spec` workspace dep. Stream consumption goes through the
sister workspace package `@vtorn/spec-client`, which exposes
`useMatchStream(url|source)` and the in-process AR-FR synthetic source.
