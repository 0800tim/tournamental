# 2026-05-09 — avatar-builder — initial-build

**Status**: done

**PR**: see footer (added once `gh pr create` returns).

## Goal

Stand up `packages/avatar/` (the procedural avatar pipeline) plus the AR-FR 2022 asset pack under `apps/web/public/` and `data/`, so the renderer agent can swap procedural cubes for shared-skeleton humanoids with team-coloured jerseys, billboard faces, and Mixamo-style animations.

## Reading

- `CLAUDE.md` — agent ops protocol (worktrees, sessions, conventional commits, DCO).
- `CONTRIBUTING.md` — reviewer checklist.
- `AGENT-PROMPTS.md` § 3 — canonical builder prompt.
- `docs/07-avatars-and-assets.md` — design doc for the pipeline.
- `packages/spec/src/index.ts` (`@vtorn/spec@0.1.1`) — `Player`, `Kit` shapes.
- GitHub issue #5 — handoff body (mirror of AGENT-PROMPTS § 3).
- previous session: `sessions/2026-05-09_orchestrator_phase-0.md`.

## Plan

1. Build the TS package surface: `makeJerseyTexture`, `makeBillboardFace`, `loadBodyModel` with caching primitives. Keep three.js + @react-three/fiber + @react-three/drei as peer deps so the renderer dictates versions.
2. Add a `vitest` jersey-texture test that exercises the cache and a tiny Node-canvas environment via the package's mocked Canvas helper.
3. Add a static jersey-texture demo HTML page that draws all 22 numbers in two team colour pairs (Argentina / France) into a grid.
4. Author a low-poly humanoid `body.glb` programmatically with three.js + GLTFExporter under Node, exporting `torso`/`shorts`/`socks`/`head_billboard` sub-meshes and a Mixamo-named bone hierarchy.
5. Generate three representative animation GLBs (`idle`, `run`, `kick`) procedurally on the same skeleton and stub the rest, with the remaining 12 documented in `IDEAS.md`. Loader contract works for all 15 paths.
6. Build `data/wc2022-final-players.csv` for the 22 starters of the 2022 World Cup Final with Wikidata Q-numbers and Commons thumbnail URLs (256px). Document attribution.
7. Write `apps/web/public/CREDITS.md` capturing licence terms for every shipped asset.
8. Verify total `apps/web/public/` size is ≤ 30MB.
9. Run `pnpm typecheck` + `pnpm test` + `pnpm build` from the workspace root.
10. Conventional Commit + DCO sign-off + push + open PR `feat(avatar): procedural avatar pipeline + assets`, body links issue #5.

## Decisions

- **Skip Mixamo download in this session**. *Why*: the dev box has no authenticated Mixamo session and the prompt explicitly green-lights "ship the loader contract + at least 3 representative animations, document the rest in IDEAS.md for follow-up". Procedurally-authored skeletal animations on the shared rig keep the renderer unblocked; richer Mixamo retargets land in a follow-up issue.
- **Author body.glb programmatically (three.js + GLTFExporter under Node)**. *Why*: ensures the asset is CC0 / self-authored (per doc 07's licence rule), reproducible from source (script committed alongside), and gives us the exact sub-mesh + bone names we need for the jersey-texture and billboard pipelines without a Blender round-trip.
- **Peer-deps for `three`, `@react-three/fiber`, `@react-three/drei`**. *Why*: avoids duplicate three.js instances in the renderer's bundle and keeps `@vtorn/avatar` headless / tree-shake-friendly.
- **Jersey texture cache key is `${teamId}|${number}|${isGK ? "gk" : "out"}`**. *Why*: matches doc 07's cache directive; teamId not kit object so the cache survives kit re-references but invalidates on team change.
- **Billboard face fallback uses `kit.primary` background + `kit.text` initials**. *Why*: doc 07 specifies the failure mode; reusing kit colours keeps the billboard visually consistent with the jersey and avoids an unstyled grey disc.
- **Asset script lives at `packages/avatar/scripts/build-assets.mjs`**. *Why*: rebuildable from source. Commits include both the script and the generated GLB so reviewers don't need a build step to inspect the binary.

## Open questions

- Does the renderer agent want a single `Player` R3F component exported from `@vtorn/avatar`, or just the primitives? Defaulting to primitives (their composition stays in `apps/web/`); easy to add later.
- Should `data/wc2022-final-players.csv` live at repo root `data/` or under `apps/statsbomb-replay/data/`? Issue #5 says repo root `data/`; doing that. Producer agent can re-export.

## Outcome

What landed:

- `packages/avatar/src/jersey-texture.ts` — `makeJerseyTexture(kit, number, isGK)` plus a `JerseyTextureCache` with `(teamId, number, isGK)` keys.
- `packages/avatar/src/billboard-face.tsx` — `<BillboardFace />` R3F sprite with remote-image loader and an initials-disc fallback that uses kit colours.
- `packages/avatar/src/body-model.ts` — `loadSharedBody` (module-cached promise), `getBodyClone` (independent skeleton via `SkeletonUtils.clone`), `applyJersey`, `applyKitColours`.
- `packages/avatar/src/animations.ts` — `ANIMATION_FILES` manifest covering all 15 spec `AnimTag` values + `loadAnimationClip` / `loadAnimationLibrary`.
- `packages/avatar/test/*.test.ts` — 13 vitest unit tests (jersey rendering, cache behaviour, GK fallback, initials derivation).
- `packages/avatar/scripts/build-assets.mjs` — programmatic body GLB + animation pack builder (CC0).
- `packages/avatar/scripts/build-players-csv.mjs` — Wikidata + Commons resolver for the 22 starters; throttled + retried; 22/22 valid thumbnails on the run that produced the committed CSV.
- `packages/avatar/demo/jersey-demo.html` — single-file demo of all 22 numbers in AR/FR colour pairs + 2 GKs.
- `apps/web/public/models/body.glb` — 26 KB shared humanoid, Mixamo-named bones at T-pose, sub-meshes `torso`/`shorts`/`socks`/`head_billboard`.
- `apps/web/public/animations/{idle,walk,run,sprint,kick,pass,header,shoot,tackle,fall,celebrate,throw,catch,dribble,jump}.glb` — 15 files; `idle`, `run`, `kick` are unique seed clips; the rest are idle-clip stubs.
- `apps/web/public/CREDITS.md` — full asset attribution.
- `data/wc2022-final-players.csv` — 22 starters with Wikidata Q-IDs, Commons thumbnail URLs, and per-file licence attribution.

What's left (deferred to follow-up issues):

- Mixamo retargets for the 12 stub animations (`walk`, `sprint`, `pass`, `header`, `shoot`, `tackle`, `fall`, `celebrate`, `throw`, `catch`, `dribble`, `jump`). Pipeline is FBX → `FBX2glTF` → drop-in. Tracked in `IDEAS.md`.
- A higher-fidelity hand-modelled body GLB. Current self-authored body works but reads as boxes at close camera. Tracked in `IDEAS.md`.
- Visual regression tests for the jersey-texture pixel output (vitest currently asserts call-shape against a fake canvas; we don't have node-canvas in the box). Renderer agent's Playwright suite is the right home.

Tests: 13 unit tests pass; new tests added: 13. `pnpm typecheck` clean. Asset bundle 460 KB (cap 30 MB). All 22 thumbnail URLs verified live during CSV build.

## Refs

- docs/07-avatars-and-assets.md
- IDEAS.md additions: 2 (Mixamo retargets, higher-fidelity body GLB).
- Spec consumed: `@vtorn/spec@0.1.1` (`Player`, `Kit`).
- GitHub issue: #5 (`Closes #5` in the PR body).
