---
name: renderer-debug
description: Triage a 3D match-renderer issue. Producer health, spec version, stream lag, avatar / kit / billboard load.
license: Apache-2.0
---

# When to use this skill

The user opened `/match/<id>` or `/world-cup-2026/molecule` and:

- Stadium is empty (no players, no ball).
- Players are visible but their kits are wrong colour.
- Faces (billboards) are missing / wrong / blurry.
- Replay HUD shows a stale score.
- Frame rate is < 30 fps on a desktop browser.
- The page is black and the JS console is showing
  WebSocket errors.

# How to do it

## 1. Pin down the layer

The renderer has four producers of state. Walk them in this order:

1. **Producer** (`apps/statsbomb-replay` for historic matches,
   `apps/wc2026-producer` for live, `apps/mock-producer` for dev).
   Is it running? `curl http://localhost:4001/healthz` (dev) or
   `wss://stream.tournamental.com/match/<id>` should accept and
   start streaming `MatchInit` then `StateFrame` messages.

2. **Stream server** (`apps/stream-server` on `:4002`). Fans
   producers out to many subscribers. `curl
   http://localhost:4002/admin/streams` (needs
   `STREAM_ADMIN_TOKEN`) lists active match channels + subscriber
   count per match.

3. **Renderer client** (in `apps/web/lib/renderer/`). Reads the
   stream and drives the R3F scene. Open the JS console:
   first-message `MatchInit` should log to console with
   `[renderer] init`. If you see `[renderer] init` but no
   `[renderer] frame`, the stream is connecting but no
   `StateFrame` is arriving.

4. **Asset pipeline** (`apps/web/public/avatars/`,
   `apps/web/public/kits/`, `apps/web/public/billboards/`). 404s
   here show in the Network tab. Missing GLB / PNG explain
   "no players visible" cleanly.

## 2. Check the spec version

The producer ships a `spec_version` field on `MatchInit`. The
renderer logs a warning if it disagrees with
`packages/spec`'s exported `SPEC_VERSION`. Mismatched versions
are the #1 cause of "stadium empty but stream is fine".

```bash
grep '"version"' packages/spec/package.json   # what the renderer expects
```

## 3. Frame-rate budget

The renderer targets 60fps with 22 players + ball on a mid-range
2022 Android, per [`docs/04-renderer.md`](../../docs/04-renderer.md).
Below 30fps on a desktop = bug.

Common culprits: shadows on Phase-3 stadium without
WebGL2-extensions, ElevenLabs live-TTS WebSocket reconnecting in
a loop, an instanced crowd material missing its atlas.

# Acceptance checks

- Healthy state: `curl /healthz` on the producer returns 200,
  `wscat -c wss://stream.tournamental.com/match/<id>` receives
  `MatchInit` within 2 seconds and `StateFrame` within 5.
- After your fix, `pnpm --filter @vtorn/web test -- renderer`
  is green.
- The `/match/<id>` page loads, shows the score in the HUD, and
  the stadium has players moving.

# Boundaries

- DO NOT modify `packages/spec/` to "fix" a version mismatch.
  The producer should be updated to match the spec, not the
  other way round.
- DO NOT touch the shadow / instancing settings in
  `apps/web/lib/renderer/scene/` without measuring before and
  after. Performance regressions are a request-changes per
  [CLAUDE.md](../../CLAUDE.md).
