# Session: 2026-05-09 — renderer-builder — initial build

**Status:** done — initial PR opened
**Branch:** `feat/web-renderer`
**Issue:** [#4](https://github.com/0800tim/vtorn/issues/4)
**Docs:** [04-renderer.md](../docs/04-renderer.md), [02-spec.md](../docs/02-spec.md), [07-avatars-and-assets.md](../docs/07-avatars-and-assets.md)

## Plan

1. Scaffold Next.js 14 (app router) at `apps/web/` with Three / R3F / drei / Zustand.
2. Create sister workspace package `packages/spec-client/` exporting `useMatchStream(url)` hook + `WebSocket` driver + Zustand match store.
3. Build `lib/` helpers: `coords.ts` (spec → three.js), `interpolation.ts` (lerp StateFrames + slerp yaw), `animation-fsm.ts` (idle/walk/run/sprint + one-shot triggers).
4. Components: `MatchScene`, `Pitch`, `Stadium` (cheap), `Player` (procedural cube/billboard, swappable for avatar pkg later), `Ball`, `HUD`, `CameraRig` (broadcast/top-down/follow-tight), `DebugPanel`, `OddsHUD` placeholder.
5. Routes: `/`, `/match/[id]`, `/replay/[id]`. Demo route uses an in-process synthetic stream when no producer is reachable, so the demo is self-contained.
6. Vitest tests for `lib/` helpers (coords, interpolation, anim FSM).
7. Run lint + typecheck + test locally before pushing.

## Key decisions

- **In-process synthetic stream fallback:** the prompt says the renderer must read from a producer's WebSocket, but the mock-producer is a parallel agent and may not be ready. To make the demo route self-contained for the reviewer, `useMatchStream` accepts either a `ws://...` URL or a synthetic source. The default route generates a tiny synthetic stream client-side so `pnpm dev` boots a watchable scene immediately. Real producer URLs are first-class and configured via `NEXT_PUBLIC_VTORN_WS_URL` env.
- **Procedural avatar v0:** capsule body + coloured kit ring + nameplate. Swap to `@vtorn/avatar` once that package lands. Cube fallback only if even capsule fails.
- **Spec untouched:** consume `@vtorn/spec` workspace dep; no shape changes.
- **Odds HUD placeholder:** `<OddsHUD />` reads `apps/web/public/data/wc2022-final-odds.json` if present and renders nothing if missing. Hook for the sister issue, no data shipped here.
- **AR-FR replay route:** `/replay/[id]` accepts a manifest URL via `?src=` query and falls back to bundled `public/replays/<id>.ndjson` if available. Renderer is source-agnostic.

## Files touched

- `apps/web/` — full Next.js app (app router, components, lib, public).
- `packages/spec-client/` — new workspace package: store, ws driver, useMatchStream hook, synthetic stream fixture.
- `apps/web/__tests__/` — vitest unit tests for `lib/` helpers.

## Open questions for orchestrator

- Should `OddsHUD` placeholder render an empty `<div>` or be feature-flagged behind `?odds=1`? Current default: render only when JSON file exists at `public/data/wc2022-final-odds.json`.
- What's the canonical match ID for AR-FR? Used `fifa-wc-2022-final-arg-fra-2022-12-18` per CLAUDE.md.
- Mock-producer port is `4002` per CLAUDE.md but issue says default `4001`. Defaulting to `4001` (matches statsbomb-replay), with `4002` documented as the mock port.

## Outcome

### What's covered (acceptance criteria from issue #4)

- Next.js 14 (app router) at `apps/web/` with `/`, `/match/[id]`, `/replay/[id]` routes.
- Components: `MatchScene`, `Pitch`, `Stadium`, `Player`, `Players`, `Ball`, `HUD`, `CameraRig`, `DebugPanel`, `OddsHUD` (placeholder).
- Sister workspace package `@vtorn/spec-client` with `useMatchStream(url|source)`, Zustand match store, WebSocket driver with reconnect, and an in-process synthetic AR-FR fixture.
- Coordinate-system mapping in `lib/coords.ts` (spec → three.js; 2D and 3D variants; in-place writer for hot loops).
- Lerp + slerp + ball extrapolation + speed estimation in `lib/interpolation.ts`.
- Animation FSM in `lib/animation-fsm.ts` (idle/walk/run/sprint by speed; one-shot pass/shoot/tackle/celebrate/fall on event.* messages).
- Camera modes: broadcast (default), top-down tactical, follow-ball-tight; on-screen toggle.
- HUD: scoreboard with team kits, period label, clock, shootout panel, event banner, rolling commentary line.
- DebugPanel: status, fps (rolling rAF estimate), lag (ms), last state `t`, frame count, camera mode; toggle with `D`.
- WebSocket source defaults to `ws://localhost:4001`; configurable via `NEXT_PUBLIC_VTORN_WS_URL` env or `?src=` query.
- `OddsHUD` placeholder loads `public/data/wc2022-final-odds.json` if present, renders nothing if not. Hook left for the sister "odds HUD" issue.
- Procedural-billboard avatar (capsule body + canvas jersey texture + nameplate) per doc 07 tier 3. GLB swap-in is one-line in `Player.tsx` once `@vtorn/avatar` lands.

### What's deferred

- Playwright e2e (vitest unit tests cover lib/ helpers; demo route is verifiable manually).
- Real GLB avatars (other agent owns `packages/avatar/`; cube/capsule fallback is in place).
- Audio commentary playback / TTS pipeline (spec extension for `audio_uri` is documented in doc 04 as v0.2).
- CDN-manifest mode of `useMatchStream` (only WebSocket + synthetic source today; manifest mode added when CDN agent lands).
- Full r3f-perf integration (homemade rAF estimator covers fps for now).
- Bloom / post-processing on goals (out of scope for v0.1 per doc 04).

### Verification

- `pnpm test` — 38 vitest tests pass (coords, interpolation, animation FSM, store/synthetic stream).
- `pnpm typecheck` — strict tsc clean across `apps/web` and `packages/spec-client`.
- `pnpm lint` — `next lint` clean for `apps/web`.
- `pnpm build` — Next.js production build succeeds, all four routes compile.
- The `__tests__/store.test.ts > MatchStore + synthetic AR-FR stream > ends with the canonical 3-3 / 4-2 scoreline` assertion is the executable form of issue #4's score acceptance criterion.

Refs: docs/04-renderer.md
Refs: docs/02-spec.md
Refs: docs/07-avatars-and-assets.md

Refs: docs/04-renderer.md
Refs: docs/02-spec.md
Refs: docs/07-avatars-and-assets.md
