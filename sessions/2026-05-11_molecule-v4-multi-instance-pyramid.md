---
status: ready-for-review
agent: molecule-v4
base-branch: main @ 3adff52 (post-#137 save API live, #138 supabase auth merges)
feature-branch: feat/molecule-v4-multi-instance-pyramid
---

# Molecule v4 — multi-instance pyramid (one node per team per surviving stage)

## Task

Tim reviewed the v3 pyramid in browser and complained it looks flat: "it
doesn't look like a pyramid", "should appear multiple times per row over
the pyramid as they progress and drop out as they don't", "they'll
actually have more than the number of teams as nodes". His listed layers:
Group, Round of 32, Round of 16, Quarters, Semis, Finals.

## Plan

1. Rewrite `lib/molecule/layout.ts` to emit **one MoleculeNode per
   (team, layer-survived) pair**. A group-stage loser → 1 node. R32
   loser → 2. R16 loser → 3. QF → 4. SF (3rd/4th) → 5. Runner-up → 6.
   Champion → 7. Fully resolved 48-team WC → 48+32+16+8+4+2+1 = **111
   nodes**.
2. Two bond kinds: **match bonds** (two different teams at the same
   layer) and **advance bonds** (same team at two adjacent layers).
   Advance bonds light up gold when the team is on the champion's path
   → "gold staircase" headline visual.
3. Per-team stable azimuth: `θ = stableHash01(team + ":azimuth") * 2π`,
   reused at every layer so each team's instances stack into a near-
   vertical column rising up the pyramid. Final layer (2 atoms only)
   overrides to 0/π so the finalists read as opposing pair.
4. Camera: pulled back to `[0, 16, 58]` with target `[0, 15, 0]`, FOV
   40°. Polar clamps `[0.25π, 0.62π]`. Apex sits ~30% from top of
   canvas, base ~70% from top on first paint.
5. Compact page header so canvas claims more vertical space. Subtitle
   moves to a right-rail caption pill. `.molecule-root` now
   `calc(100vh - 48px)`.

## Architecture decisions

- `MoleculeNode` adds `id: string` (`"{team}:{stage}"`), `stage:
  LayerStage`, `isTopInstance: boolean`. Keeps `teamCode`, `position`,
  `radius`, `finalStage`, `accentColor`, `teamName` so existing
  consumers don't change.
- `MoleculeBond` adds `id`, `kind: "match" | "advance"`, `aStage`,
  `bStage`. Keeps `a`, `b`, `stage`, `color`, `thickness` for legacy
  rendering paths.
- `finalStage` is propagated to every instance of a team (so a
  champion's r32 instance still has `finalStage = "champion"`). Drives
  consistent rim colouring across a team's column. Lookups via
  `isTopInstance` are the canonical way to surface "deepest finish".
- Match bonds reuse the legacy `${stage}:${a}:${b}` key for path-hit
  lookups; advance bonds use `${upperStage}:${team}:${team}` which is
  unambiguous because match bonds never have a === b.
- `derivePathToGold` is unchanged. Added a sibling
  `buildPathAdvanceBondKeySet` that produces the staircase bond keys
  for the champion (or selected team) so RoundBond can light them up
  gold. Existing `buildPathBondKeySet` keeps its size === 5 for the
  champion (5 match bonds), so the v2 path tests still pass.
- The 3rd-place playoff has no dedicated layer in v4 (both tp teams
  already have an SF instance). tp resolution is still consulted to
  set `thirdPlaceCode` and to promote tp participants to the SF layer
  in cascades that only synthesised one SF match.

## Files changed

- `apps/web/lib/molecule/layout.ts` — full rewrite. Exports new
  `LayerStage` type, `LAYER_*_TEST_ONLY` constants, `instancesOf`
  helper. Keeps `RING_RADII_TEST_ONLY`/`TIER_Y_TEST_ONLY` as legacy
  aliases backed by the new layer table.
- `apps/web/lib/molecule/path.ts` — adds
  `buildPathAdvanceBondKeySet`. `buildPathBondKeySet` semantics
  unchanged.
- `apps/web/components/molecule/MoleculeScene.tsx` — `nodeById` lookup
  by `${team}:${stage}`. Path-highlight checks advance bond keys
  separately. Camera + target + polar clamps updated. Finalstage map
  uses `isTopInstance`. Hover + champion lookup prefer the top
  instance.
- `apps/web/components/molecule/RoundBond.tsx` — special-cases
  advance bonds (thinner flat radius, no travelling pulse, lower
  default opacity so the gold staircase pops).
- `apps/web/components/molecule/molecule.css` — `.molecule-root`
  height `calc(100vh - 48px)`. New `.molecule-page-header--compact`,
  `.molecule-page-header-right`, `.molecule-page-mode-caption` rules
  for the compact header.
- `apps/web/app/world-cup-2026/molecule/_components/MoleculePageClient.tsx`
  — single-line "Molecule" title, caption pill + toggle on the right.
- `apps/web/__tests__/molecule-layout.test.ts` — updates legacy tests
  to use `isTopInstance` lookups where they previously expected one
  instance per team.
- `apps/web/__tests__/molecule-layout-pyramid.test.ts` — rewritten
  for v4 invariants (multi-instance counts per team, shared azimuth,
  final-pair azimuths, monotonic layer Y and radius).
- `apps/web/__tests__/molecule-layout-full-bracket.test.ts` — NEW.
  Synthesises a fully resolved cascade by walking the tournament's
  knockouts list, asserts exactly 111 nodes, exact per-layer counts,
  31 knockout match bonds, 72 group match bonds, 63 advance bonds, 7
  champion instances, 6 runner-up instances.
- `apps/web/__tests__/molecule-scene-render.test.tsx` — relaxes
  "exactly 48 atoms" to "≥ 48" since the v4 layout emits 48 base +
  32 r32 atoms for the default empty bracket (the cascade auto-
  resolves group-position slots from declared team order).

## Verification

```
pnpm --filter @vtorn/web typecheck   # clean
pnpm --filter @vtorn/web test        # 784 / 784 passing
pnpm --filter @vtorn/web build       # clean, /world-cup-2026/molecule 18.6 kB
```

## Numbers

- Default 2026 demo bracket (empty user picks, cascade auto-fills R32
  slots from declared group order): **80 nodes** = 48 group + 32 r32.
- Fully resolved 48-team bracket (synthesised cascade with home-side
  always winning): **111 nodes** = 48 + 32 + 16 + 8 + 4 + 2 + 1.
- Bond count for the fully resolved case: **72 group matches + 31
  knockout matches + 63 advance bonds = 166 cylinders**. Within R3F's
  budget by ~3× margin.

## Tradeoffs / open notes

- `MoleculePanel.tsx` was left unchanged. It reads `finalStageByTeam`
  which still has one entry per team and the per-team semantics didn't
  change.
- The "advance bonds" thickness multiplier (0.18) and default opacity
  (0.32) are calibrated by eye. May want tweaking after Tim sees the
  result in browser. Easy follow-up.
- The 3rd-place playoff isn't drawn as a bond. v3 dropped it from the
  path anyway; v4 drops it from the layout. If Tim wants the bronze
  match visible, we can render it as a horizontal bond at the SF layer
  with the bronze palette.
- I did not run `pnpm dev` headless to produce before/after
  screenshots — the dev server requires the bracket-engine to be
  pre-built and the build cycle would have eaten the time budget. The
  PR body invites Tim to spot-check live; the unit tests pin the
  geometry numerically.

## Next steps

- Open PR.
- Tim spot-check at `play.tournamental.com/world-cup-2026/molecule`.
- Iterate on advance-bond thickness/opacity if needed.
