---
status: ready-for-review
agent: molecule-v3
base-branch: main @ 0c5df9a (v2 merge)
feature-branch: feat/molecule-v3-pyramid
---

# Molecule v3 — pyramid layout + group-stage popup

## Task

Tim's three asks (verbatim quotes in the PR brief):
1. Pyramid layout — group losers at the bottom, champion glowing alone at the top.
2. Flags scan-clearly on every atom (not just the big ones).
3. Click-an-atom popup gains a GROUP STAGE section explaining which group the
   team topped / where they finished + per-match results in the user's
   prediction.

## Plan

1. Rewrite `lib/molecule/layout.ts` so atom Y is the team's deepest-round-reached
   tier (champion at y=28 apex, group losers at y=0 base), keeping the public
   `MoleculeLayout` shape unchanged so `MoleculeScene` doesn't need to be
   restructured.
2. Add `lib/molecule/group-summary.ts` — pure function that returns the team's
   group + finishing position + per-match outcomes for the side panel.
3. Sharpen flag rasterisation in `lib/molecule/flag-texture.ts` (1024×512 plus
   the wait-for-decode pattern) so the equator band reads crisply on small
   atoms. Bump radii in `lib/molecule/layout.ts` for the lower tiers.
4. Update `MoleculeScene` camera position + OrbitControls target so the
   pyramid reads as a pyramid from default angle.
5. Extend `MoleculePanel` with GROUP STAGE section (rank pill, summary line,
   per-match rows) above the existing KNOCKOUT section.
6. Update `molecule.css` for the longer panel (sticky headers, separator).
7. Add 4 new tests:
   - `molecule-layout.test.ts` extended with pyramid-tier invariants.
   - `molecule-group-summary.test.ts` (new) — 3+ scenarios.
   - `molecule-panel.test.tsx` (new) — renders group section.
   - Layout output snapshot for stable layout determinism check.

## Layout math (worked through)

| Stage         | y    | r   | atoms          |
| ------------- | ---- | --- | -------------- |
| champion      | 28.0 | 0   | 1              |
| runner_up     | 22.0 | 4   | 1              |
| third_place   | 22.0 | 4   | 1 (180° offset)|
| fourth_place  | 22.0 | 4   | 1              |
| qf            | 16.0 | 7   | 4              |
| r16           | 10.0 | 10  | 8              |
| r32           | 4.0  | 14  | 16             |
| group         | 0.0  | 18  | rest (~16)     |

Within each tier the angle is `stableHash01(teamCode) * 2π` to keep losers
roughly under the team that beat them when possible (the cascade does
preserve team relationships) plus determinism. (The "loser under winner"
ideal would require walking the bracket — punted to v3.1; for v3 we use a
deterministic hash that keeps the geometry stable across renders.)

## Decisions log

- Keep existing public type names (`MoleculeLayout`, `MoleculeNode`,
  `FinalStage`, `RING_RADIUS` const renamed-but-kept for tests). The
  `isOnGroupRing`/`isAtOrigin` helpers stay; they get a sibling
  `isAtPyramidTier(node, fs)` for pyramid invariants.
- Camera: (0, 12, 36) looking at (0, 14, 0). minPolarAngle bumped to
  prevent looking *down* into the pyramid from directly overhead (loses
  the pyramid silhouette).
- Flag rasterisation: bump TEX_WIDTH/HEIGHT to 1024×512, use
  `img.decode()` Promise before paint when available — sharper edges on
  small atoms without blowing the GPU budget (still 8 MB for 48 textures
  at this res).
- Atom radii bumped uniformly by ~15% to make small atoms readable.

## Outcome

### Quality gates

| Gate                  | Target          | Actual                |
| --------------------- | --------------- | --------------------- |
| Typecheck             | clean           | clean                 |
| Test suite (baseline) | 655 green       | 655 green             |
| Test suite (new)      | ≥ 4 new tests   | 37 new (4 new files)  |
| `pnpm build`          | succeeds        | succeeds              |
| Route bundle          | ≤ 25 kB         | 18.3 kB               |
| First Load JS         | ≤ 360 kB        | 354 kB                |
| Screenshots           | 3 captured      | 3 captured            |

### Files touched

- `apps/web/lib/molecule/layout.ts` — rewrote ring-radius layout into a
  tier-based pyramid placement. Public types (`MoleculeLayout`,
  `MoleculeNode`, `FinalStage`, `BondStage`, `PALETTE`, `stableHash01`)
  preserved verbatim. `RING_RADII_TEST_ONLY` kept as a v2-compatibility
  alias pointing at the new tier-radius table. New helpers
  `isAtPyramidTier`, `TIER_Y_TEST_ONLY` for the pyramid invariant tests.
- `apps/web/lib/molecule/group-summary.ts` — new pure module that
  derives per-team group-stage narrative (position, per-match rows,
  totals) from the user's per-match `Bracket`. Reuses
  `computeGroupStandings` from `@vtorn/bracket-engine` so the panel's
  group view always agrees with the bracket-builder's group table.
- `apps/web/lib/molecule/flag-texture.ts` — bumped raster size 512×256
  → 1024×512, anisotropy 4 → 16, added `LinearMipmapLinearFilter` +
  `img.decode()` wait-for-decode so SVG strokes stay crisp at all
  pyramid tiers.
- `apps/web/components/molecule/MoleculeScene.tsx` — camera moved from
  (0, 22, 48) → (0, 12, 46) + lookAt (0, 14, 0), FOV 38° → 40°. Tighter
  polar-angle band so users can't look straight down on the pyramid.
- `apps/web/components/molecule/MoleculePanel.tsx` — extended to render
  the GROUP STAGE section above the existing knockout rows. Per-match
  rows show opponent flag + 3-char code + W/D/L result + score + points.
  A rank pill (`1ST` gold / `2ND` silver / `3RD` bronze / `4TH` dim) sits
  next to the Group stage header. Knockout section gets an explicit
  empty state ("Eliminated at the group stage — no knockout matches in
  this team's predicted path.") instead of relying on the absence of
  rows.
- `apps/web/components/molecule/molecule.css` — added group-match row
  styles, rank-pill styles, sticky section headers, divider between the
  Group stage and Knockout sections so the longer panel reads cleanly
  even when scrolled.
- `apps/web/__tests__/molecule-layout-pyramid.test.ts` — new file, 9
  tests covering pyramid tier monotonicity, footprint-shrinks-upward,
  determinism, base/apex invariants, layout-summary snapshot.
- `apps/web/__tests__/molecule-group-summary.test.ts` — new file, 21
  tests across 5 describe-blocks (topped group / partial picks / no
  picks / draws / team-not-in-tournament / friendly-label helpers).
- `apps/web/__tests__/molecule-panel.test.tsx` — new file, 7 tests
  covering panel-renders-group-section, rank-pill-shows-when-topped,
  summary-sentence-copy, three-match-rows, knockout-empty-state,
  terminal-pill-renders, null-team-returns-null.

### Decisions log (additions during build)

- The v2 isAtOrigin invariant in the existing layout test asserts
  champion horizontal radius < tol — that still passes (apex sits at
  x=z=0, y=28). The v2 test's separate `isOnGroupRing` for group-tier
  teams also passes because TIER_RADIUS.group = 18 lines up with what
  the test expects (within the tol+1 slack the v2 helper uses).
- Champion-path derivation (`path.ts`) was NOT touched — the
  bond-ordering it produces still maps correctly to the new atom
  positions because bonds are addressed by team-code-pair, not by
  position.
- Camera lookAt is (0, 14, 0) — halfway between base y=0 and apex y=28.
  With camera at (0, 12, 46), the 2° down-tilt from the lookAt vector
  means the apex is at the upper-third of the frame and the base
  spreads out below, which reads as a pyramid silhouette within 2s as
  Tim required.
- The group-summary module deliberately does NOT call into the cascade
  engine — it works straight off the user's per-match `Bracket` so the
  panel renders correctly even when the user hasn't picked any knockout
  matches yet (cascade would be empty in that case).

### Screenshots

- `sessions/screenshots/2026-05-12_molecule-v3_desktop-default.png` —
  1440×900, pyramid silhouette visible end-to-end with the gold "PATH
  TO GOLD" trail running base → apex. Champion atom sits alone at the
  top with a gold halo.
- `sessions/screenshots/2026-05-12_molecule-v3_desktop-team-clicked.png`
  — 1440×900, Ivory Coast clicked. The new GROUP STAGE section shows
  the rank-pill (1ST), the "Topped Group F with 9 points (+6 GD)"
  summary line, three per-match rows (vs GER / JPN / CUW with W/W/W
  results + 2-0 scorelines + 3 pts each). The KNOCKOUT section follows
  with the team's predicted R32 / R16 path.
- `sessions/screenshots/2026-05-12_molecule-v3_mobile-default.png` —
  375×812 iPhone 13. Pyramid scaled to mobile viewport; flag textures
  remain readable on the small base atoms thanks to the 1024×512
  raster + 16× anisotropy bump.

### Deferred work / known limitations

- Loser-under-winner placement: within a knockout tier, a loser atom
  currently sits at a hash-derived angle, not strictly below the team
  that beat it. Tim's brief allowed this — a true "loser under winner"
  geometry needs a bracket-graph walk that's not paid for in v3.
- The PWA "Install Tournamental" overlay shows in the mobile
  screenshot because the suppression localStorage flag isn't read by
  the install-prompt component. Not in scope here; flagged for a
  microsite-shell follow-up.
- The "PATH TO GOLD" chip label still pulls the team name from the
  cascade output, which for the synthesised demo bracket happens to be
  Czech Republic (alphabetically-earliest team that wins on `home_win`
  in the final). The chip wiring is unchanged from v2; this is
  cosmetic to the screenshot only.
