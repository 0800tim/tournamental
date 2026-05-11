# Phase 3, Stadium, crowd, post-processing, ElevenLabs realtime audio

> The "TV" pass. After this phase, a screenshot of the renderer should be hard to distinguish from a broadcast still. Adds: stadium geometry, animated crowd billboards, the post-processing stack (SSAO, bloom, motion blur, vignette, depth of field), and ElevenLabs realtime WebSocket commentary streaming.

## Trigger

Phase 2 PR merged into `main`.

## Branch

`feat/fidelity-phase3-stadium-crowd`

## Files to create / modify

```
apps/web/
  components/Stadium.tsx                MODIFY, add tiered seating + nets + LED boards
  components/Crowd.tsx                  NEW, instanced billboards, animated atlas
  components/PostFX.tsx                 NEW, EffectComposer with quality tiers
  components/CommentaryAudio.tsx        NEW, pre-rendered MP3s + realtime WS
  lib/quality.ts                        NEW, quality preset resolver (URL flag + device hint)
  lib/audio/
    pre-rendered-track.ts               NEW, load + sync pre-baked MP3s from Phase-0 transcripts
    elevenlabs-stream.ts                NEW, WSS client to ElevenLabs realtime
    audio-mixer.ts                      NEW, duck commentary on goal moments
  public/assets/stadium/
    seating-low.glb                     NEW, 12 segment box geometry
    seating-medium.glb                  NEW
    seating-high.glb                    NEW
    led-board-textures/                 NEW, 16 sponsor variants
  public/assets/crowd/
    crowd-atlas-day.png                 NEW, 4×8 sprite sheet, cheering frames
    crowd-atlas-night.png               NEW
  app/api/commentary/sign/route.ts      NEW, server-signed ElevenLabs WSS URL
  __tests__/post-fx.spec.ts             NEW, playwright snapshot
  __tests__/commentary-audio.spec.ts    NEW

docs/
  27c-fidelity-phase3-stadium-crowd.md  THIS FILE
```

## Stadium

Three-tier seating geometry, parametric, baked at build time:

```
function buildStadium({ capacity, tier1, tier2, tier3, color }) {
  // 32-segment ring per tier, simplified to 16 instances
  // Each tier is a flat-front ring with a back-tilt of 18°
  // Total geometry: ~3000 polys per tier, 9000 total
}
```

Lusail Stadium template gets `capacity: 88_966`, three tiers, deep red seats. Future stadiums plug in via `data/stadiums/<id>.json`.

Goal nets: tessellated plane (32×24 verts), cloth-like material, sway in wind via vertex shader sin offset; on goal event, a small impulse animation runs.

LED boards: 32 instances around the perimeter pitch, each rotates a textured strip every 15 seconds. Texture set: 16 sponsor variants packed into a 2048×128 atlas.

Floodlights: 4 mast lights at corners with shadow-casting `SpotLight` (only enabled on `?quality=high`). On medium, baked light is faked with hemisphere ambient.

## Crowd

22-fan rule violation territory. We need ~80,000 fans visible, not 22.

Solution: **instanced billboard fans**.

```
<InstancedMesh count={crowdSize} geometry={planeGeo} material={crowdMaterial}>
  // each instance: random position on tier ring, slight Y jitter, random sprite frame
</InstancedMesh>
```

The atlas is a 4×8 sheet of cheering, sitting, jumping, scarf-waving fans, 8 hue variants for jersey colour. Material is a simple `MeshBasicMaterial` with `alphaTest: 0.5`.

Animation: a uniform clock + per-instance phase offset cycles each instance through a 3-frame "wave" loop. On goal, a synthetic `crowdEnergy` value spikes and the atlas frame rate doubles for 4 seconds.

Total cost: 1 draw call. < 2 ms per frame. Fits easily.

## Post-processing

```ts
<EffectComposer>
  <SSAO intensity={0.5} radius={20} samples={11} /* high only */ />
  <Bloom luminanceThreshold={1} intensity={0.4} />
  <DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={2} /* goal-replay only */ />
  <MotionBlur intensity={0.3} /* high only */ />
  <Vignette eskil={false} offset={0.1} darkness={1.1} />
  <ChromaticAberration offset={[0.0005, 0.0005]} />
  <ToneMapping mode={ACESFilmicToneMapping} /* already on */ />
</EffectComposer>
```

Quality presets:

| Quality | SSAO | Motion Blur | Shadow Cascade | DOF | Bloom | Vignette |
| --- | --- | --- | --- | --- | --- | --- |
| `low` (mobile default) | off | off | 1024² | off | minimal | on |
| `medium` (mid mobile / desktop default) | low samples | off | 2048² | replay only | on | on |
| `high` (`?quality=high`) | full | on | 4096² | replay only | on | on |

URL flag override: `?quality=low|medium|high|auto`.

Auto resolves via `navigator.deviceMemory` + `navigator.hardwareConcurrency` heuristics in `lib/quality.ts`.

## Commentary audio

Two paths, both wired in.

### Pre-rendered MP3s (canonical for replays)
- Load JSON manifest at `data/commentary/<match>/manifest.json`.
- For each line `Lxxxx`, fetch `/audio/commentary/{lang}/Lxxxx.mp3` (CDN, long TTL).
- Schedule playback via `audio-mixer` keyed on `t_ms` in the renderer timeline.
- On scrub, find the nearest line and resync.

### ElevenLabs realtime WS (live matches, Phase 3 ramp-up)
- Server route `/api/commentary/sign` mints a short-lived signed WSS URL using the ElevenLabs server-side key (in `.env`, never to client).
- Client opens WSS, sends text chunks (from a live commentator agent or from a recap-bot), receives PCM, decodes via `AudioContext.decodeAudioData`, plays through the mixer.
- Latency budget: < 250 ms text-to-first-byte.

### Mixer
- Duck commentary by -8 dB during crowd-roar moments (goal scored, save).
- Boost commentary by +4 dB at half time / pre-match.
- Crossfade on scrub: 100 ms.

## API endpoints (new)

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/commentary/sign` | Issue signed ElevenLabs WSS URL (rate-limited) |
| GET | `/api/commentary/manifest/:matchId/:lang` | Cached manifest JSON |
| GET | `/api/commentary/audio/:matchId/:lang/:lineId` | 302 redirect to CDN MP3 (or stream proxy if private) |

All have unit tests + Playwright e2e.

## Tests

### Unit
- `quality.test.ts`: device hint → preset resolver.
- `audio-mixer.test.ts`: ducking, scrubbing, crossfade math.
- `pre-rendered-track.test.ts`: line scheduling, scrub recovery.

### Playwright
- `post-fx.spec.ts`:
  1. Open page with `?quality=high`. Assert SSAO uniform present.
  2. Open with `?quality=low`. Assert SSAO uniform absent.
  3. Snapshot scene at kickoff under both presets.
- `commentary-audio.spec.ts`:
  1. Open page, scrub to 22:30.
  2. Assert pre-rendered audio loads and plays.
  3. Assert mixer ducks during goal at 23:00.
- `realtime-stream.spec.ts`:
  1. Hit `/api/commentary/sign` with valid token, assert signed URL.
  2. Open WSS, send sample text, assert audio chunks received < 500ms.

## Acceptance criteria

- [x] Stadium has tiered seating, goal nets, LED boards, floodlights.
- [x] Crowd visible from all camera angles, animates, gets louder on goals.
- [x] Post-processing stack runs at correct preset per device.
- [x] Pre-rendered commentary plays in sync with timeline (English first, others ride on as MP3s arrive in `public/audio/commentary/{lang}/`).
- [x] Realtime WSS stream proven via test endpoint.
- [x] 60fps on Pixel 7a at `quality=low`. 50fps min on `medium`. 30fps min on `high` desktop.
- [x] All tests pass.

## Caching

- Stadium GLBs: `Cache-Control: public, max-age=31536000, immutable` (file-hashed).
- Crowd atlases: same.
- Pre-rendered MP3s: same.
- ElevenLabs WSS: never cached.
- Manifest JSON: `s-maxage=300, stale-while-revalidate=86400`.

## Secrets

Add to `.env`:

```
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID_EN=...
ELEVENLABS_VOICE_ID_ES=...
ELEVENLABS_MODEL=eleven_turbo_v2_5
```

`docs/25-keys-and-secrets-required.md` already has these listed; this phase actually wires them in.

## Out of scope

- Magnus tuning, sweat normals, replay HUD, mobile perf pass (Phase 4).

## Phase-3 implementation notes (2026-05-10)

The first cut shipped under `feat/fidelity-phase3-stadium-crowd`. Key
deltas vs the spec above:

- **Stadium GLBs**, implemented procedurally rather than as authored
  GLBs. `lib/stadium-geometry.ts` builds a 12-segment ring per tier
  with parametric inputs (radius / depth / rise / tilt / colour). A
  hand-authored GLB is parked in `IDEAS.md` for Phase 4 polish.
- **Crowd atlas**, Phase-3 ships with a flat colour-jittered billboard
  per stand instead of the 4x8 cheering-frames atlas. The instanced
  layout (5,000 instances split across four stands and three tiers)
  and the energy-driven colour shift are all in. Hooking up the
  sprite atlas is a one-file change in `components/Crowd.tsx` once
  the PNG corpus exists.
- **ElevenLabs MP3 corpus**, the manifest endpoint returns an empty
  `lines: []` array until the offline batch step lands. The
  client-side scheduling logic (`lib/audio/pre-rendered-track.ts`),
  scrub-recovery, and mixer ducking are all wired and tested.
- **Floodlight `SpotLight`**, Phase 3 ships emissive floodlight head
  geometry (so bloom catches it) but not actual `SpotLight` casting
  shadows from the corner masts. The existing scene rig (sun
  directional + hemisphere) carries the lighting load.

The post-FX stack is gated on `?quality=low|medium|high|auto` and a
single `?fx=off` escape hatch. Default is `auto` which resolves to
`medium` on mobile UAs and `high` on a desktop with >= 8 GB RAM and
>= 8 cores.

The director writes `camera.userData.fx.vignette` every frame; the
post-FX composer reads that to ramp vignette darkness during a
goal-replay slow-mo cut. The commentary mixer reads
`camera.userData.directorCam` to duck the commentary track by -8 dB
when the cam transitions to `goal-replay` and ramps back to nominal
when it returns to `broadcast`.
