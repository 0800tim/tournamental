# FIFA-grade fidelity roadmap (R3F / WebGL)

> Goal: bring the AR-FR replay (and every match after it) up to a "screenshot-from-FIFA-on-Xbox" visual standard, while staying in React Three Fiber and hitting 60fps on a mid-range 2022 Android. No native, no Pixel Streaming, no proprietary engines.

The path is four phases, each shippable in isolation. Each phase has its own doc with concrete file targets, libraries, tests, and acceptance criteria. Phases run **in sequence** but the next phase's builder agent boots as soon as the previous one's PR merges, so total wall-clock is roughly the longest phase, not the sum.

| Phase | Doc | Builder agent | Key win | Wall-clock |
| --- | --- | --- | --- | --- |
| 1 | [27a-fidelity-phase1-mocap-rig.md](27a-fidelity-phase1-mocap-rig.md) | `agent: fidelity-phase1` | Real rigged players, real run/sprint/kick animation, no foot sliding | ~3-4 hr |
| 2 | [27b-fidelity-phase2-physics-director.md](27b-fidelity-phase2-physics-director.md) | `agent: fidelity-phase2` | Foot IK, Rapier ball, auto-director with goal slow-mo | ~4-6 hr |
| 3 | [27c-fidelity-phase3-stadium-crowd.md](27c-fidelity-phase3-stadium-crowd.md) | `agent: fidelity-phase3` | Crowd, stadium, post-processing stack, ElevenLabs realtime audio | ~6-8 hr |
| 4 | [27d-fidelity-phase4-polish.md](27d-fidelity-phase4-polish.md) | `agent: fidelity-phase4` | Magnus curves, sweat normals, replay HUD, mobile perf pass | ~4-6 hr |

## What "FIFA-grade" means here

We are not chasing AAA-PC fidelity. We are chasing **the look and feel of a broadcast highlight**:

- Player avatars feel like humans, not mannequins. They have heads, hair, jerseys with sponsor logos, and they run with authority.
- Animation matches motion. No foot sliding. No pop transitions.
- Ball obeys physics. Shots arc. Free kicks curl. Headers send the ball where they should.
- Camera knows what to look at. On a goal, the camera switches, slows down, and the commentary breathes.
- Crowd, lighting, post-processing make the scene feel like it's on a TV, not in Blender.

## Non-goals

- Not building a playable game. We're building a watch-along of historical and live data.
- Not licensing FIFA brand or EA assets. All assets are Apache/CC-BY/permissive.
- Not running native code. Browser only. WebGL2 baseline; WebGPU upgrade gated behind `?gpu=webgpu`.

## Common stack across all phases

- **R3F**: `@react-three/fiber`, `@react-three/drei` (already in use)
- **Animation**: `three` AnimationMixer + a small state machine (Phase 1)
- **IK**: `three-ik` or `yuka` (Phase 2)
- **Physics**: `@dimforge/rapier3d-compat` via `@react-three/rapier` (Phase 2)
- **Post-processing**: `@react-three/postprocessing` (Phase 3)
- **Avatar**: Ready Player Me API for 3D heads, Mixamo body pack with retarget (Phase 1)
- **Audio**: `howler.js` for SFX, native `Audio` for commentary, ElevenLabs WebSocket streaming for live (Phase 3)

## Mobile-perf budget (every phase MUST stay inside)

- 60fps steady-state on Pixel 7a / Galaxy A52 with 22 players + ball + stadium + crowd.
- < 80 draw calls.
- < 50 MB total transferred per match-load (excluding audio chunks).
- LCP < 2.5s on the renderer page.
- Gate expensive effects (SSAO, motion blur, depth of field, shadow cascade) behind `?quality=high` URL flag. Default mobile = `medium`. Default desktop = `high`.

## Testing strategy

Every phase ships with:

1. **Unit tests** for any new pure logic (vitest).
2. **Playwright E2E test** that opens the renderer at `?match=fifa-wc-2022-final-arg-fra-2022-12-18&time-scale=10`, scrubs to a goal, and asserts: scene mounts, no errors in console, frame timing under budget.
3. **Visual snapshot** at three checkpoints (kickoff, Messi 23' goal, penalty shootout) saved to `apps/web/test-fixtures/visual/` for manual review on the PR.
4. **API endpoint tests** (vitest) for any new route.

## Sequencing rule

- Phase N+1 agent boots when Phase N's PR is merged into `main`.
- The orchestrator (or a CronList watcher) handles this. Each phase doc lists its **trigger condition** explicitly.

## Caching + performance addendum

Per CLAUDE.md and `docs/22-deployment-and-tunnels.md`:

- Static asset hashes: `Cache-Control: public, max-age=31536000, immutable`.
- GLB models: served from `/_next/static/media/*` once Next 14 fingerprints them, automatic.
- Mixamo FBX → GLB pre-processing happens at build time, never at request time.
- ElevenLabs MP3s: pre-rendered, served from CDN with long TTL.
- Realtime ElevenLabs WS streaming (Phase 3): no caching, direct duplex.

## What's already in place (Phase 0, done)

- ACES tonemapping, drei `<Sky>`, basic shadows.
- Procedural body GLB, runtime jersey-texture generator, billboard faces from Wikidata.
- Timeline scrubber + manifest mode (NDJSON.gz).
- StatsBomb event stream → renderer.
- 22 starters + ball positions interpolated.
- Verbose commentary transcript (English, 2972 lines, ElevenLabs-ready).

Phase 1 builds **on top** of these, the goal is replacing the procedural body + billboard face with a rigged Ready Player Me avatar that runs with real Mixamo animation.
