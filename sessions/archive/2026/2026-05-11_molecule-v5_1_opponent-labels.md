---
status: ready-for-review
agent: molecule-opp-labels
base-branch: main @ cadd3cb (post-#153 share-by-guid resolver merged)
feature-branch: feat/molecule-opp-labels
---

# Molecule v5.1: opponent labels on every gold-path stage

## Task

Tim 2026-05-11 on `play.tournamental.com/world-cup-2026/molecule`:

> "Molecule paths still aren't perfect. As you go up each stage of the
> tournament, it should say and be connected to the team that you are
> playing, but it doesn't seem to be clearly doing that in this view.
> For example, I can't see where they're facing England clearly."

v5 (PR #149) shipped a small two-flag "match badge" above each gold
path-bond ("🇦🇷 vs 🇲🇽 · R32"), but the badge didn't name either side
and the opponent atoms on each layer didn't stand out from the
non-path teams. With the gold trail snaking through 48 atoms across 7
rings, the eye has to trace bonds to figure out who the champion beat
at each stage. Tim wants the opponent at every stage *unmistakable*.

## Plan

1. **Match-bond badge rewrite.** The pill becomes "**STAGE · vs <FLAG>
   <NAME>**" with the opponent's full team name as the dominant token.
   Lead with the stage tag so the eye picks up "SF" first, then
   "England". Drops the path team's own flag from the badge (already
   on the path-team's atoms).
2. **Silver "VS" chip on opponent atoms.** When a team is an opponent
   on the active path (not on it themselves), their top-instance gets
   a silver "VS" chip above the team-code label and a silver rim halo
   (distinct from gold). The eye can sweep all 5 silver-haloed atoms
   and see "these are the 5 opponents on this path".
3. **Data wiring.** `MoleculeScene` derives two new lookups from the
   active TeamPath:
   - `pathOpponentByMatchBondKey: bondKey → { code, name }` , passes
     the opponent's code + display name into each gold match-bond.
   - `pathOpponentAtomCodes: Set<string>` , opponent codes for the
     atom-rim driver.
4. **No layout changes.** Atoms, layer pyramid, KO glyphs, advance
   bonds all stay. We only add labels and rim treatments.
5. **Performance.** No new R3F geometry. The badge is still a single
   drei `<Html>` per gold bond (5 per active path), the silver rim
   reuses the existing back-side sphere on opponent atoms (no extra
   mesh). Steady-state 60fps budget on a mid-range 2022 Android
   unaffected.

## Files touched

- `apps/web/components/molecule/MoleculeScene.tsx` , derives
  `pathOpponentByMatchBondKey`, `pathOpponentAtomCodes`,
  `teamNameByCode`, threads them into `MoleculeWorld`.
- `apps/web/components/molecule/RoundBond.tsx` , replaces
  `fromFlag/toFlag` with `opponentCode / opponentName / opponentFlag`;
  badge layout reorders to lead with stage, then "VS", then opponent.
- `apps/web/components/molecule/TeamAtom.tsx` , accepts
  `isPathOpponent`, renders silver "VS" chip + silver rim.
- `apps/web/components/molecule/molecule.css` , larger badge font,
  new `.molecule-match-badge-opp` rule, new `.molecule-label-vs`
  silver chip, opponent-label data attribute.
- `apps/web/__tests__/molecule-v5_1-opponent-labels.test.ts` , new
  unit tests covering the opponent-derivation invariants.

## Outcome

- 127 / 127 molecule tests passing (`pnpm vitest run __tests__/molecule`).
- 7 new unit tests in `molecule-v5_1-opponent-labels.test.ts` cover:
  the opponent code per match-bond, never-the-path-team-itself, one
  opponent per stage, runner-up's path, empty cascade fallback, and
  the opponent atom set.
- `pnpm --filter @vtorn/web typecheck` and `... build` are red on the
  feature branch but ALSO red on clean main (pre-existing
  `AppShell`/`AppMenuDrawer` import break unrelated to this work).
  `tsc --noEmit` on this work alone is green. ESLint clean on all
  changed files.

## Next steps

- Tim QA on `play.tournamental.com/world-cup-2026/molecule` once the
  PR is merged + deployed.
- If the silver rim halo on the opponent atoms competes too hard with
  the gold path team for visual prominence, consider scoping it to
  hover-only , toggle is a one-line change in the JSX. Defer.

Refs: docs/04-renderer.md
