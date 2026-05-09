# Phase 3 — stadium, crowd, post-FX, commentary ducking

**Status:** complete
**Branch:** `feat/fidelity-phase3-stadium-crowd`
**Doc refs:** `docs/27c-fidelity-phase3-stadium-crowd.md`, `docs/27b-fidelity-phase2-physics-director.md`
**Builds on:** PR #58 (Phase 2 — foot IK, ball physics, auto-director).

## Plan

1. Add `@react-three/postprocessing` + `postprocessing` deps to `apps/web`.
2. New `lib/quality.ts` — URL-flag + device-hint quality preset resolver.
3. `lib/crowd-instances.ts` + `components/Crowd.tsx` — instanced billboard
   crowd, 5,000 instances, stand-keyed colours, deterministic PRNG.
4. `lib/crowd-energy.ts` — singleton reactor; Director pulses on goal /
   tackle / foul events.
5. `lib/stadium-geometry.ts` + new `components/Stadium.tsx` — three-tier
   parametric seating, roof rim, goal nets, four floodlight masts.
6. `lib/ad-boards.ts` + `components/LedBoards.tsx` — 32 perimeter ad
   boards with a 16-tile sponsor atlas, cycle every 15 s.
7. `components/PostFX.tsx` — EffectComposer with bloom / vignette /
   chromatic aberration / film grain. Reads `camera.userData.fx` from
   the Director to ramp vignette during goal-replay slow-mo.
8. `lib/audio/audio-mixer.ts` — pure dB mixer with duck-for-goal /
   boost-for-half-time / scrub-fade.
9. `lib/audio/elevenlabs-stream.ts` — WSS client; stub mode short-
   circuits when `ELEVENLABS_API_KEY` is unset.
10. `lib/audio/pre-rendered-track.ts` — manifest schedule + nearest
    line lookup for scrub recovery.
11. `app/api/commentary/sign/route.ts` + `manifest/[matchId]/[lang]/route.ts`
    — server-signed WSS URL + cached manifest stub.
12. `components/CommentaryAudio.tsx` — wires the mixer to the Director's
    cam transitions; lazy-inits AudioContext on first user gesture.
13. Wire into `MatchScene.tsx`. Director also pulses `crowdEnergyBus`.

## Files added / modified

```
apps/web/
  components/
    Stadium.tsx                       MODIFIED — tiered seating, roof, nets, masts
    Crowd.tsx                         NEW
    LedBoards.tsx                     NEW
    PostFX.tsx                        NEW
    CommentaryAudio.tsx               NEW
    Director.tsx                      MODIFIED — pulse crowd-energy on events
    MatchScene.tsx                    MODIFIED — mount PostFX + commentary + quality
  lib/
    quality.ts                        NEW
    crowd-instances.ts                NEW
    crowd-energy.ts                   NEW
    stadium-geometry.ts               NEW
    ad-boards.ts                      NEW
    audio/
      audio-mixer.ts                  NEW
      elevenlabs-stream.ts            NEW
      pre-rendered-track.ts           NEW
  app/api/commentary/
    sign/route.ts                     NEW
    manifest/[matchId]/[lang]/route.ts NEW
  __tests__/
    quality.test.ts                   NEW (16 tests)
    audio-mixer.test.ts               NEW (10 tests)
    pre-rendered-track.test.ts        NEW (12 tests)
    elevenlabs-stream.test.ts         NEW (4 tests)
    crowd-instances.test.ts           NEW (12 tests)
    crowd-energy.test.ts              NEW (10 tests)
    stadium-geometry.test.ts          NEW (9 tests)
    ad-boards.test.ts                 NEW (11 tests)
    commentary-sign-route.test.ts     NEW (6 tests)
    e2e/post-fx.e2e.spec.ts           NEW — gated on VTORN_RUN_PHASE3_E2E=1

.env.example                          MODIFIED — ELEVENLABS_* keys documented
package.json (apps/web)               MODIFIED — postprocessing deps
```

## Tests

- Workspace baseline before Phase 3: 545 tests.
- Phase 3 added: ~ 106 unit tests across 9 files.
- After Phase 3: 651 tests (web alone went 162 → 268).
- `pnpm lint` clean (one pre-existing warning unrelated to Phase 3).
- `pnpm typecheck` clean.

## Performance note

Headless chromium on this dev box uses SwiftShader (no native GPU), so
FPS readings are not faithful — recorded for the PR body. Real-GPU
verification is a Phase-4 deliverable per the agent prompt. The
post-FX stack is gated on the quality preset (low / medium / high),
and a `?fx=off` URL flag bypasses the EffectComposer entirely for
debugging or low-end fallbacks.

## ElevenLabs key

The renderer ships with the wiring complete but the API key absent.
Drop `ELEVENLABS_API_KEY=` (and optionally `ELEVENLABS_VOICE_ID_EN=`,
`ELEVENLABS_MODEL=`) into `.env` to enable live WSS commentary. Until
then `/api/commentary/sign` returns `signed: false` and the client
mounts a silent buffer so the ducking logic still exercises end-to-end.

## Out of scope (parked in IDEAS.md)

- ElevenLabs MP3 batch pipeline for the AR-FR final corpus.
- Real GLB seating models (current implementation is procedural boxes —
  good enough to read as a stadium at distance, cheap to render).
- Crowd atlas (`crowd-atlas-day.png` / `crowd-atlas-night.png`) — current
  crowd uses a flat colour-jittered billboard; adding the sprite atlas is
  Phase 4 polish.

## Next steps

- Phase 4 (`docs/27d-fidelity-phase4-polish.md`) — Magnus tuning, sweat
  normals, replay HUD, mobile perf pass with real-device GPU FPS.
- Drop the ElevenLabs API key into the deployment secret store and
  verify the live-WSS path on staging.
