# 07, Avatars and Assets

> How players actually look in the rendered scene. Three options shipped, all driven by the same `Player` field set in MatchInit.

## The three avatar tiers

The renderer picks the highest-fidelity option for which assets are available, falling back gracefully:

1. **GLB avatar** (`player.avatar_uri`). Full skinned 3D character with face geometry. Used by forks that ship custom characters (Roblox-flavoured worlds, anime worlds, animal mascots).
2. **Ready Player Me avatar** (`player.rpm_avatar_id`). Generated from a single profile photo. Free service, optimized for web, ~2–4MB per avatar. Used when we want photoreal-ish player likenesses without bespoke modelling.
3. **Procedural billboard-face avatar.** Fallback. Generic body GLB + a quad with the face image (`player.face_uri`) as a billboard always facing the camera + procedural jersey texture (kit colours and number). Cheap, works without any per-player modelling, and looks intentionally stylized like Wii Sports / Mii / Mario Strikers, a *charm*, not an embarrassment.

If `face_uri` is also missing, the procedural avatar uses an initials disc instead of a photo.

## Procedural body GLB

A single shared mesh (`public/models/body.glb`, ~150KB) is the base for tier 3. Properties:

- Roughly humanoid, low-poly (~3K tris), neutral-coloured base material.
- Rigged with a Mixamo-compatible skeleton, T-pose at origin.
- One material slot per body region: `torso`, `shorts`, `socks`, `head_billboard`. Each is a separate sub-mesh with its own texture so we can repaint them at runtime per team.

This single asset is reused for every player on every team. Differences come from runtime-generated textures.

## Runtime jersey texture

`lib/jersey-texture.ts`. Given a `Kit` and a `Player`, produce a `THREE.CanvasTexture` for the torso material:

```ts
export function makeJerseyTexture(kit: Kit, number: number, isGK = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;

  const k = isGK && kit.goalkeeper ? kit.goalkeeper : kit;
  ctx.fillStyle = k.primary;
  ctx.fillRect(0, 0, 512, 512);

  // simple secondary stripe across the chest
  ctx.fillStyle = k.secondary;
  ctx.fillRect(0, 200, 512, 40);

  // big number on the back (UV-mapped to back of torso)
  ctx.fillStyle = k.text ?? "#FFFFFF";
  ctx.font = "bold 280px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), 256, 384);

  return new THREE.CanvasTexture(c);
}
```

About 30 lines for a usable result. Cache by `(team_id, number, isGK)` and reuse, there are at most 22 unique textures per match.

## Billboard face

A `<sprite>` (or a `<mesh>` with a billboard shader) parented to the head bone. Renders the `face_uri` texture as a flat plane that always faces the camera. PNG with transparent background recommended, square 256×256.

Failure mode: if the image fails to load, render an initials disc with the kit colour as background, uses the same texture pipeline as `makeJerseyTexture`.

## Ready Player Me integration

RPM is a free service that generates GLB avatars from a single photo. Workflow:

1. Operator uploads a profile photo to RPM via their hosted UI (or REST API).
2. RPM returns a `glb_url` and a stable `avatar_id`.
3. Operator stores the avatar ID against the player in the producer config.
4. Producer includes `rpm_avatar_id` in the MatchInit message.
5. Renderer fetches `https://models.readyplayer.me/<id>.glb` and uses it instead of the procedural body.

Sizes are around 2–4MB each, fine to load eagerly for both starting XIs (44 avatars × 3MB = 132MB) but use HTTP/2 multiplexing and start the load while the user is on the pre-match HUD.

License: RPM avatars under their default ToS are free for non-commercial open-source use. Document this in the project README.

## Animations

Mixamo provides free, high-quality, retargetable animations for everything we need. Curate a small pack and check it in to `apps/web/public/animations/`:

```
animations/
  idle.glb
  walk.glb
  run.glb
  sprint.glb
  kick.glb
  pass.glb
  header.glb
  shoot.glb
  tackle.glb
  fall.glb
  celebrate.glb
  throw.glb
  catch.glb
  dribble.glb
  jump.glb
```

All retargeted onto the same Mixamo skeleton at the same scale. Loaded once into a shared `THREE.AnimationMixer` template; cloned per player.

For RPM avatars, the same animations work because RPM uses a Mixamo-compatible skeleton. For custom GLBs (tier 1) the world author is responsible for ensuring skeleton compatibility, call this out in the renderer extension docs.

The animation FSM in `lib/animation-fsm.ts` (see [docs/04-renderer.md](04-renderer.md)) maps spec `AnimTag` values to these clips.

## Field, ball, stadium

- **Pitch**: a single 105×68 plane with a procedurally generated line texture (penalty boxes, centre circle, half-line). Single mesh, baked at startup. Material with subtle stripe for cut-grass look.
- **Ball**: standard sphere, ~22cm radius, with a checkered or pentagon-hex texture for visible rotation. ~600 tris is plenty.
- **Stadium**: low-poly bowl + billboarded crowd ring. Off the shelf from Sketchfab CC0 packs is fine. Don't model individual seats.

## Asset licensing summary

For the open-source default world, every shipped asset must be CC0, CC-BY-compatible, or self-authored. Do not check in copyrighted club crests, real player photos, sponsor logos, or licensed fonts. Faces from real player photos are the operator's responsibility, they're referenced by URL in the producer's MatchInit, never bundled with the renderer.

Practical defaults for v0.1:

- **Body GLB**: author one in Blender or use Mixamo's free X Bot character.
- **Animations**: Mixamo (free, with attribution if static).
- **Stadium**: a CC0 pack from Sketchfab (curate one, attribute in README).
- **Ball**: author a simple textured sphere.
- **Fonts**: Inter (OFL) for HUD.

## Acceptance criteria

- [ ] All three avatar tiers render correctly with no console errors.
- [ ] Switching tiers per-player (some on, some off `avatar_uri`) works without regressions.
- [ ] Jersey texture readable at typical broadcast camera distance (number visible).
- [ ] Animations transition cleanly (no T-pose flicker) between idle/walk/run/sprint and during one-shots.
- [ ] Asset bundle ≤ 30MB total for procedural-only mode (excludes RPM/custom GLBs which are lazy-loaded).
