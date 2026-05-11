# Tournament Molecule View — feat/tournament-molecule-view

- **Date**: 2026-05-12
- **Branch**: `feat/tournament-molecule-view` off `main` at `db4c7b4`.
- **Status**: ready for review (v1 complete).
- **Doc refs**: Tim's verbal spec 2026-05-11; `apps/web/app/world-cup-2026/page.tsx`; `apps/web/components/MatchScene.tsx`; `packages/social-cards/src/canvas/bracket-share-card.ts`.

## Plan (5–10 lines)

1. Pure layout function (`apps/web/lib/molecule/layout.ts`) — input: tournament + cascaded bracket; output: nodes (with positions, radii, palette) + bonds. Deterministic, no R3F.
2. R3F scene (`apps/web/components/molecule/`) — TeamAtom (sphere + rim glow + drei `<Html>` label with flag emoji + 3-letter code), RoundBond (cylinder between atom centres), MoleculePanel (slide-in side panel), MoleculeLegend (top-right overlay).
3. Page (`/world-cup-2026/molecule`) — server component loads + enriches the WC 2026 tournament, mounts the client scene wrapper.
4. Client wrapper handles the "🎲 Show different prediction" toggle (your picks ↔ rank-favourite consensus).
5. Tests — pure layout unit tests + page render smoke (R3F scene stubbed).
6. Playwright screenshot of the molecule against the running prod build.

## Decisions made (so future-me can read the call chain)

- **Layout algorithm**: concentric rings keyed by final stage reached, with a small deterministic y-jitter per team so the molecule reads 3D rather than as a flat disc. Ring radii: champion 0 → group losers 28 units. **Not** force-directed for v1 — concentric rings are predictable, cheap, and look clean. Tim's CLAUDE.md note said "go force-directed only if the static layout looks dead" — it does not look dead, so I stopped here. If we want force-directed v2, `d3-force-3d` is the smallest credible dependency.
- **Atom material**: kit-primary colour as the main mesh + back-side rim sphere in the stage palette colour (gold/silver/bronze/orange/blue/slate). Champion gets a stronger glow + slow 2.2 Hz pulse, hovered atoms scale to 1.08, selected to 1.18.
- **Flags**: instead of fighting SVG-to-Texture decoding I went with the flag emoji + 3-letter code rendered through drei `<Html>` as DOM. Simpler, scales cleanly, no font-baking required, and looks great. The `flag_emoji` field already exists on every canonical team in `data/fifa-wc-2026/teams.json`.
- **Bond rendering**: cylinders, not `<Line />`. Cylinders have volume so they don't go hairline-thin from distance; they pick up scene light so the stage palette colour reads warmer where the camera grazes the surface. 103 cylinders total, well within budget.
- **Consensus toggle**: synthesises a "rank-favourite" Bracket from FIFA rank — every group match's higher-ranked team wins (draws if within 3), every group's ranked tiebreaker is filled, every knockout's home side picked. The cascade engine then resolves who actually advances each round. This is **not** Polymarket consensus — it's an honest rank proxy. The cascade-resolver is the same multi-pass loop the BracketBuilder uses (per-stage iterative, capped at 6 passes).
- **Idle auto-rotate**: drei OrbitControls' built-in `autoRotate`, toggled off for 1.8s after every pointerdown/wheel/touchstart. Speed 0.35 rad/s — slow enough to feel like a meditative orbit, not a carousel.
- **Empty state**: when there's no knockout pick yet we still render the 48 group-eliminated atoms on the outer ring AND show a soft CTA card pointing the user back at `/world-cup-2026`. The page is never blank.
- **Tone mapping + light rig**: ACES filmic + exposure 1.05 (vs MatchScene's 0.85 — the molecule has no blown-out emissives so it can afford a brighter exposure). Light intensities sum to 1.95 — comfortably under the 2.5 mobile budget. No fog, per Tim's stadium-scene note.
- **Cache policy**: `export const revalidate = 600` on the page; initial HTML is the same for every viewer (the user's bracket comes from localStorage on the client). Marketing-flavoured surface; safe to cache aggressively at the edge.

## Files touched

New:

- `apps/web/lib/molecule/layout.ts` — pure layout function.
- `apps/web/components/molecule/MoleculeScene.tsx` — R3F canvas + scene mount.
- `apps/web/components/molecule/TeamAtom.tsx` — single team sphere.
- `apps/web/components/molecule/RoundBond.tsx` — cylinder edge between two atoms.
- `apps/web/components/molecule/MoleculePanel.tsx` — selected-team side panel.
- `apps/web/components/molecule/MoleculeLegend.tsx` — palette legend overlay.
- `apps/web/components/molecule/molecule.css` — overlay chrome (labels, panel, legend, tooltip, empty state, page header).
- `apps/web/app/world-cup-2026/molecule/page.tsx` — Next.js server route.
- `apps/web/app/world-cup-2026/molecule/_components/MoleculePageClient.tsx` — client wrapper + your-picks/consensus toggle.
- `apps/web/__tests__/molecule-layout.test.ts` — 15 layout-invariant tests (champion-at-origin, group-on-outer-ring, palette mapping, bond emission, determinism).
- `apps/web/__tests__/molecule-page.test.tsx` — page render-smoke test.

## Quality gates

- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/web test` for the new files — 18 / 18 pass.
- Full suite — 605 / 611 pass; the 6 failures are pre-existing on `main@db4c7b4` (`MatchPredictionRow.mobile-fit.test.tsx`, not touched by this branch — verified by stashing my changes and re-running).
- `pnpm --filter @vtorn/web build` — succeeds. New route ships at `14.3 kB / 349 kB First Load JS` (includes three.js + drei).
- Lint clean (one pre-existing warning in `TeamFlag.tsx`).

## Manual visual check

Built + ran `next start -p 3300`, navigated to `http://localhost:3300/world-cup-2026/molecule`. Screenshots:

- Empty state (no picks): `sessions/screenshots/2026-05-12_molecule_empty-state.png`
- Consensus-bracket populated: `sessions/screenshots/2026-05-12_molecule_consensus-bracket.png`
- Same, slightly rotated by auto-orbit: `sessions/screenshots/2026-05-12_molecule_consensus-rotated.png`

The molecule reads exactly as Tim asked: golden champion at the centre, silver/bronze in the inner ring, bonds glow warmer through the deeper rounds, group-stage teams cluster on the outer ring threaded by thin grey group bonds.

## What's left for v2

- **Real consensus source.** Today the "different prediction" toggle builds a rank-proxy. Swap it for a live Polymarket / aggregated-odds bracket via `/api/odds/snapshot` (same source `BracketBuilder.handleAutoPick` uses) so the toggle reads "consensus" honestly.
- **Force-directed option.** Add `d3-force-3d` and let users toggle between "concentric" and "free-float" layouts. Concentric is the right default; force-directed is the showstopper.
- **Animated MP4 share.** Render a 6-second orbit reveal of the user's molecule as a video share via `ffmpeg` (mirror the `bracket-reveal.ts` pipeline). Tim's instructions explicitly de-scoped this for v1.
- **Per-bond match preview.** Hover a bond → small label "Group A · MEX vs RSA · home win predicted". Today bonds are visually informative but not clickable.
- **R3F mount test.** Wire `@react-three/test-renderer` so the scene component can be smoke-tested under jsdom without a WebGL context. Today the page test stubs the scene; the layout function is unit-tested directly.
- **Reduced-motion respect.** When `prefers-reduced-motion: reduce`, disable the champion pulse + idle auto-rotate.

## Note for the reviewer

GitHub Actions billing is currently failing on the account (`0800tim/tournamental`), so CI on this PR will fail at the "account payments have failed" stage. PRs #127 and #130 were merged via `gh pr merge --admin --squash`; this one likely needs the same.

## Next steps

- Open PR `feat/tournament-molecule-view` against `main`.
- Body file: this session note.
- Reviewer: an admin merge once eyeballed.
