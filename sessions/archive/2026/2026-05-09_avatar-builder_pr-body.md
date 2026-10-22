## Summary

Procedural avatar pipeline for VTourn renderers, plus the AR-FR 2022
asset pack. Consumes `@vtorn/spec@0.1.1` `Player` / `Kit` shapes;
exposes runtime jersey-texture generation, billboard faces with
initials-disc fallback, a shared body GLB loader with per-clone
skeletons, and a manifest-driven animation library covering every spec
`AnimTag`.

Implements [GitHub issue #5](https://github.com/0800tim/vtorn/issues/5)
and [`AGENT-PROMPTS.md` § 3](../blob/main/AGENT-PROMPTS.md#3-builder--packagesavatar-and-appswebpublic-assets).
Design doc:
[`docs/07-avatars-and-assets.md`](../blob/main/docs/07-avatars-and-assets.md).

## What changed

`packages/avatar/`

- `src/jersey-texture.ts` — `makeJerseyTexture(kit, number, isGK)` +
  `JerseyTextureCache` keyed on `(teamId, number, isGK)`. SSR/Node
  friendly via injectable `canvasFactory` / `textureFactory`.
- `src/billboard-face.tsx` — R3F `<BillboardFace />` sprite. Loads
  remote face image; falls back to an initials disc painted with kit
  colours on missing/failed image (matches doc 07 failure mode).
- `src/body-model.ts` — `loadSharedBody`, `getBodyClone`
  (`SkeletonUtils.clone` for independent skeletons),
  `applyJersey` / `applyKitColours`.
- `src/animations.ts` — `ANIMATION_FILES` manifest covering all 15
  `AnimTag` values + `loadAnimationClip` / `loadAnimationLibrary`.
- `test/` — 13 vitest unit tests.
- `scripts/build-assets.mjs` — programmatic body GLB + animation pack
  generator (CC0).
- `scripts/build-players-csv.mjs` — Wikidata + Commons resolver.
- `demo/jersey-demo.html` — single-file demo of 22 numbers in AR/FR.

`apps/web/public/`

- `models/body.glb` — 26 KB shared humanoid, Mixamo-named bones at
  T-pose, sub-meshes `torso` / `shorts` / `socks` / `head_billboard`.
- `animations/*.glb` — 15 files. Unique seed clips for `idle`, `run`,
  `kick`. Remaining 12 ship as idle-clip stubs that satisfy the loader
  contract; Mixamo retargets tracked in `IDEAS.md` for v0.2.
- `CREDITS.md` — full asset attribution + verification recipe.

`data/`

- `wc2022-final-players.csv` — 22 starters with Wikidata Q-IDs,
  Commons thumbnail URLs (`Special:FilePath` redirect), and per-file
  licence attribution. All 22 URLs verified live during CSV build.

## Acceptance criteria (issue #5)

- [x] Jersey-texture demo renders 22 readable jersey numbers in two
      team colour pairs (AR + FR + GKs).
- [x] Asset bundle in `apps/web/public/` ≤ 30 MB total — currently
      460 KB.
- [x] `data/wc2022-final-players.csv` has 22 valid Wikimedia Commons
      image URLs (verified live during the build).
- [x] License attributions documented in `apps/web/public/CREDITS.md`.
- [~] Mixamo animations transition cleanly without T-pose flicker —
      seed clips (idle, run, kick) verified on the rig; 12 stubs use
      the same skeleton and idle-pose so transitions stay smooth, but
      they read as static. Full Mixamo retargets parked in `IDEAS.md`
      per the prompt's "ship the loader contract + at least 3
      representative animations" directive.

## Coordination

- The renderer agent (`feat/web-renderer`) added empty
  `apps/web/public/{models,animations,data}/` directories. This PR
  populates them with the actual binary assets. Orchestrator owns the
  merge order; if renderer's PR lands first the directories will already
  exist (no conflict).
- This PR does not touch `apps/web/` source code (the renderer agent
  owns that surface). It only adds files under `apps/web/public/`.

## Verification commands

```bash
pnpm install
pnpm --filter @vtorn/avatar test       # 13/13 pass
pnpm --filter @vtorn/avatar typecheck  # clean

# Rebuild from source (idempotent)
node packages/avatar/scripts/build-assets.mjs
node packages/avatar/scripts/build-players-csv.mjs   # needs network

# Visual check
open packages/avatar/demo/jersey-demo.html
```

## Test plan

- [x] `pnpm test` — 13 unit tests cover jersey rendering, cache
      behaviour, GK kit fallback, initials derivation.
- [x] `pnpm typecheck` clean across the whole workspace.
- [x] `node packages/avatar/scripts/build-assets.mjs` produces the
      committed binaries deterministically.
- [x] `node packages/avatar/scripts/build-players-csv.mjs` resolves
      22/22 Q-IDs and verifies 22/22 thumbnail URLs.
- [ ] Renderer integration once `feat/web-renderer` lands — swap stub
      cubes for `getBodyClone()` and confirm 22 jerseys render at 60fps
      on the AR-FR replay stream. Tracked as a Phase-1 integration
      checkpoint by the orchestrator.

Refs:
- docs/07-avatars-and-assets.md
- sessions/2026-05-09_avatar-builder_initial-build.md
- packages/spec/src/index.ts (`@vtorn/spec@0.1.1`)

Closes #5
