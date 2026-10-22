# 2026-05-12 — Molecule v2: flag-wrapped atoms + champion-path highlight

**Branch**: `feat/molecule-v2-flag-spheres`
**Worktree**: `/home/clawdbot/clawdia/projects/vtorn-molecule-v2`
**Status**: ready for review

## Brief

Tim, reviewing the v1 of the tournament molecule view:

> "Real representation is a good start, but I want the flags there, kind of
> with a waving 3D effect. Make it spherical flag balls for their country
> a lot more interesting, and it really should show who they're playing on
> the way to get to the final."

Two asks:

1. Wrap each country flag around its atom sphere with a subtle "flag rippling
   in the wind" effect.
2. Make the predicted path to the final visually obvious — at a glance the
   viewer should see the chain of 5 opponents the champion beats on the way
   to gold (R32 → R16 → QF → SF → F).

## What shipped

### 1. Flag-wrapped sphere atoms with wind-wave displacement

- New `apps/web/lib/molecule/flag-texture.ts` — runtime cache that loads
  `public/flags/<id>.svg`, paints it onto a 512×256 OffscreenCanvas with
  dark-navy pole tinting (so the poles don't read as flat white caps),
  and returns a `THREE.CanvasTexture` shared by every atom of that team.
  Fallback canvas (kit-accent colour) renders immediately so the scene
  is never blank while SVGs load.
- New `apps/web/components/molecule/FlagSphereMaterial.tsx` — extends
  `MeshStandardMaterial` via `onBeforeCompile` with ~20 lines of GLSL
  in the vertex shader. Displaces verts along the normal by
  `(sin(uv.x·k + t·s + phase) · 0.55 + sin(uv.y·k2 + t·s2 + phase·1.7) · 0.45) · uWaveAmp`.
  Per-atom phase offset (deterministic from `stableHash01(teamCode)`) so
  spheres don't ripple in sync. Wave amp = 3% of sphere radius at rest,
  +60% on hover/select, +35% permanent boost for the predicted champion.
- `TeamAtom` switched to the new material, sphere geometry bumped to
  48×32 segments so the wave deformation reads cleanly without polygon
  faceting. The rim-glow back-sphere stays (gives the stage-palette
  colour: gold/silver/bronze/blue/etc) and shifts to gold when the atom
  is on the highlighted path.
- Reduce-motion: clamps wave amp to 0 (sphere stays static but still
  flag-textured + lit).

### 2. Champion path highlight (gold trail)

- New `apps/web/lib/molecule/path.ts` — `derivePathToGold(cascaded, teamCode)`
  returns the ordered R32→F chain of bonds + the set of atoms on the path.
  Excludes the 3rd-place playoff bond (the gold trail is to the trophy,
  not the consolation branch). Pure function, deterministic, no clock
  reads. Returns empty path on missing/null input.
- `MoleculeScene` derives both the **champion's** path (default) and the
  **selected team's** path, picks one as the active highlight (selected
  team wins if its panel toggle is ON, else champion).
- `RoundBond` v2:
  - Base thickness bumped across rounds: group 0.055 → R32 0.08 → R16 0.1
    → QF 0.13 → SF 0.16 → F 0.22 (mults on `bond.thickness`).
  - On-path bonds: 2× radius, gold `#fbbf24`, emissive intensity 0.9.
  - Travelling pulse sphere along path bonds — each bond owns a slice
    of a 3-second loop, with stagger derived from `pathIndex`. Pulse
    travels from outer-ring atom toward centre. Hidden under reduce-motion.
  - Group bonds tween to opacity 0 when the camera is auto-rotating OR
    the user has been idle 5+ seconds. They tween back in on interaction.
    Mounted at all times (no unmount thrash).

### 3. Side panel: opponent flags + highlight toggle

- `MoleculePanel` rows now show a 24×16 flag for the next opponent (SVG
  via `/flags/<code>.svg`, lazy-loaded, with a small rounded box and a
  fallback `?` glyph if the SVG can't load).
- New "Highlight on scene" toggle (gold-track checkbox) at the top of
  the path section. Default ON. When OFF, clicking this team does NOT
  replace the default champion-path gold trail.

### 4. "PATH TO GOLD" chip

- Top-centre floating chip (gold border + gradient, blurred backdrop)
  appears whenever the active highlight is the default champion path
  (i.e. either no team is selected, or the selected team's toggle is
  OFF). Shows the champion's flag emoji + team name. Pulsing gold dot
  on the left for a tiny "live trail" cue. Disabled animation under
  prefers-reduced-motion.

### Quality gates

- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/web test` — **655 passed (was 639 on main)**:
  - 13 new tests in `__tests__/molecule-path.test.ts`:
    - Returns exactly 5 bonds in R32→R16→QF→SF→F order for the champion.
    - Excludes the 3rd-place playoff bond.
    - Collects opponents into `atomCodes`.
    - Falls back to empty when champion has no R32 opponent yet.
    - Falls back to empty when team not in any knockout.
    - Bond keys lex-sorted, round-trip through `buildPathBondKeySet`.
    - Empty/null/undefined team-code → empty path.
    - Group bonds excluded from path.
    - Semi-finalist who lost: SF bond yes, tp bond no.
    - reachesFinal / winsFinal flags correct for champion + runner-up.
  - 3 new tests in `__tests__/molecule-scene-render.test.tsx`:
    - `<MoleculeScene>` mounts under stubbed R3F without throwing.
    - Renders 48 FlagSphereMaterial stubs (one per team).
    - Renders 48 `<Html>` labels (one per team).
- `pnpm --filter @vtorn/web build` — succeeds:
  - Route weight `/world-cup-2026/molecule`: **17 kB / 351 kB First Load**.
    Up from v1's 14.3 kB / 349 kB by +2.7 kB / +2 kB. Well within the
    22 kB / 360 kB budget set in the brief.

### Screenshots

- `sessions/screenshots/2026-05-12_molecule-v2_desktop-default-path.png`
  Desktop 1440×900: champion path (Mexico, in the consensus bracket) traced
  in gold from rim to centre. PATH TO GOLD chip top-centre. Flag spheres
  clearly readable: ARG, BRA, MEX, ENG, GER, FRA.
- `sessions/screenshots/2026-05-12_molecule-v2_desktop-clicked-team.png`
  Desktop 1440×900: clicked Netherlands. Side panel shows NED → CAN (WIN
  in R32) → GER (OUT in R16) with opponent flags. Gold path replaced with
  Netherlands' route through the bracket.
- `sessions/screenshots/2026-05-12_molecule-v2_mobile-default-path.png`
  Mobile 375×812: PATH TO GOLD chip clearly visible, gold trail dominates
  the centre. Mobile bottom nav unobstructed.

## Decisions

- **Runtime texture rasterisation** over build-time. Flag SVGs already
  ship for the 2D bracket UI; loading them at runtime into a single
  CanvasTexture per team keeps the bundle lean and lets us swap flags
  without rebuilding. Cost is one ~30ms paint per unique team on first
  view, behind a fallback canvas so the user never sees a blank atom.
- **MeshStandardMaterial + onBeforeCompile** over a full ShaderMaterial.
  Keeps PBR lighting (directional + ambient + hemisphere) for free; we
  only inject the ~20 lines of GLSL needed for the wave. Bundle cost
  is the GLSL string in our component (~1 KB) and the per-atom phase
  uniform.
- **Wave amplitude = 3% of radius**. Anything bigger reads as a deformed
  ball, not a rippling flag. We boost to ~5% on hover/select for tactile
  feedback.
- **Pulse travels outer → centre**. The viewer's eye follows the gold
  trail "in toward the trophy" rather than out, matching the storytelling
  metaphor.
- **Group bonds hidden during rotation, not unmounted**. Opacity tween so
  the scene never has a hard pop when the user interacts. They come back
  on the first pointermove.
- **3rd-place playoff excluded from path-to-gold**. The "road to the
  final" is exactly the 5 bonds R32→R16→QF→SF→F. The bronze branch is a
  parallel side-tree.

## Deferred (parked in IDEAS.md if/when we revisit)

- Force-directed layout for flag clusters (currently concentric rings;
  layout is unchanged per brief).
- MP4 / GIF export of the gold-trail pulse animation as a shareable
  asset on the OG card.
- Animated bond formation when the user makes a new knockout pick (a
  bond "grows" from one atom toward the other rather than appearing).
- Real Polymarket / odds-driven consensus bracket (current consensus is
  a FIFA-rank fallback; see `MoleculePageClient.buildFavouriteBracket`).
- High-res flag textures for the champion atom (4× the current 512×256
  for the centre piece, which is the most-zoomed sphere).

## Files changed

- `apps/web/components/molecule/TeamAtom.tsx` — flag-sphere + path-aware rim.
- `apps/web/components/molecule/RoundBond.tsx` — thickness, gold path,
  travelling pulse, group-bond fade.
- `apps/web/components/molecule/MoleculeScene.tsx` — derive both
  champion path + selected-team path; thread `onPath` to atoms and bonds;
  wire the highlight toggle; pass interaction state to control group-bond
  visibility.
- `apps/web/components/molecule/MoleculePanel.tsx` — opponent flags,
  highlight toggle.
- `apps/web/components/molecule/molecule.css` — PATH TO GOLD chip,
  toggle styles, on-path label glow, opponent-flag styling.
- `apps/web/components/molecule/FlagSphereMaterial.tsx` — **NEW**.
- `apps/web/lib/molecule/flag-texture.ts` — **NEW**.
- `apps/web/lib/molecule/path.ts` — **NEW**.
- `apps/web/__tests__/molecule-path.test.ts` — **NEW**, 13 tests.
- `apps/web/__tests__/molecule-scene-render.test.tsx` — **NEW**, 3 tests.

## Refs

- Brief: Tim, 2026-05-11
- Existing v1 PR: #131 (merged via `--admin --squash`)
- Repo: `0800tim/tournamental`
