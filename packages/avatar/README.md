# @vtorn/avatar

> Procedural avatar pipeline for VTorn renderers. Owned by
> [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) § 3 and tracked in
> [GitHub issue #5](https://github.com/0800tim/vtorn/issues/5). See
> [docs/07-avatars-and-assets.md](../../docs/07-avatars-and-assets.md)
> for the design spec.

One shared body GLB. Runtime canvas-generated jersey textures (team
colours + numbers). Billboard face quads with images sourced from
Wikidata for the 22 starters of any given match. Asset bundles live
under [`apps/web/public/`](../../apps/web/public/); the CSV of
WC2022-final starters lives at [`data/wc2022-final-players.csv`](../../data/wc2022-final-players.csv).

## Public API

```ts
import {
  // Jersey textures
  makeJerseyTexture, JerseyTextureCache,
  // Billboard face
  BillboardFace, deriveInitials,
  // Body
  loadSharedBody, getBodyClone, applyJersey, applyKitColours,
  // Animations
  ANIMATION_FILES, loadAnimationClip, loadAnimationLibrary,
} from "@vtorn/avatar";
```

### Jersey texture

```ts
const cache = new JerseyTextureCache();
const tex = cache.get(team.id, team.kit, player.number, player.position === "GK");
torsoMaterial.map = tex;
```

The cache scopes textures by `(team_id, number, isGK)` so a 22-player
match generates at most 22 unique torso textures. Goalkeeper kits use
`kit.goalkeeper` when present.

### Billboard face

```tsx
<BillboardFace
  faceUri={player.face_uri}
  kit={team.kit}
  initials={deriveInitials(player.name)}
/>
```

Loads the remote face image via `THREE.TextureLoader`. On load failure
or when `faceUri` is missing, falls back to an initials disc painted
with the kit colours — the failure mode specified in doc 07.

### Body model

```ts
const body = await getBodyClone();
applyKitColours(body, team.kit.primary, team.kit.secondary);
applyJersey(body, jerseyTexture);
group.add(body.scene);
```

The shared GLB is loaded exactly once and cached at module scope.
`getBodyClone()` returns an independent skeleton for per-player
animation playback while sharing geometry/material instances.

### Animations

```ts
const lib = await loadAnimationLibrary(["idle", "run", "kick"]);
const idle = lib.get("idle"); // THREE.AnimationClip | null
mixer.clipAction(idle!).play();
```

`ANIMATION_FILES` is the manifest of every `AnimTag` value in the spec.
`loadAnimationLibrary` preloads any subset; `loadAnimationClip` loads a
single clip on demand. Missing files resolve to `null` so the renderer
can substitute `idle`.

## Asset pack (under `apps/web/public/`)

- `models/body.glb` — single shared body, ~26 KB, ~800 tris,
  Mixamo-named bones at T-pose. Sub-meshes named `torso`, `shorts`,
  `socks`, `head_billboard`.
- `animations/*.glb` — 15 files. v0.1 ships unique loops for
  `idle`, `run`, `kick`; the other 12 are stub clips on the same rig
  that satisfy the loader contract. Mixamo retargets tracked in
  [`IDEAS.md`](../../IDEAS.md) for v0.2.
- Total bundle: ~460 KB (well under the 30 MB acceptance budget).

## Demo

[`demo/jersey-demo.html`](demo/jersey-demo.html) — open in any browser
to see the 22 starting numbers in Argentina + France colours plus the
two goalkeeper variants. The demo embeds the texture function inline so
no bundler is required.

## Build assets from source

```bash
# Body GLB + animation pack. Self-authored, CC0.
node packages/avatar/scripts/build-assets.mjs

# WC2022 final players CSV (Wikidata + Commons; needs network).
node packages/avatar/scripts/build-players-csv.mjs
```

Both scripts are deterministic given the same inputs and idempotent.

## Tests

```bash
pnpm --filter @vtorn/avatar test
```

13 unit tests covering jersey texture rendering, the cache, GK kit
fallback, and `deriveInitials` edge cases. Browser/3D integration is
exercised by the renderer agent's Playwright suite (out of scope here).

## Licensing

All shipped binary assets are CC0 (self-authored). Player face images
are referenced by URL in `data/wc2022-final-players.csv`; each row
carries the upstream Wikimedia Commons attribution. See
[`apps/web/public/CREDITS.md`](../../apps/web/public/CREDITS.md).
