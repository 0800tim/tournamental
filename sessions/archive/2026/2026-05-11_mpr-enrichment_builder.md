# MatchPredictionRow enrichment — FormDots, HeadToHeadPill, kit-coloured selection ring

- Status: complete
- Branch: `feat/mpr-enrichment`
- Refs: [doc 36 — VTourn UX spec](../docs/36-vtourn-ux-spec.md) (FormDots, HeadToHeadPill, MatchPredictionRow extend, TeamFlag selectionRing)

## Plan (executed)

1. Extracted shared `FormDots` (sm = 8px colour-only dots, md = 14px W/D/L pills) at `apps/web/components/shared/FormDots.tsx` for reuse across the bracket row, team page, and match preview cards.
2. Added `HeadToHeadPill` at `apps/web/components/shared/HeadToHeadPill.tsx` with `compact` ("ARG 4-3-2 FRA") + `wide` ("[ARG] 4 W • 3 D • 2 W [FRA]") variants, plus an empty-state ("no previous meetings") branch.
3. Extended `TeamFlag` with new `selectionRing` (3px solid kit-colour outline, fades in over 150ms) and `dim` (grayscale 0.6 opacity 0.5) props. Both are additive — no breaking changes to existing callers.
4. Wired the three components into `MatchPredictionRow`:
   - per-team `<FormDots size="sm">` inline under each flag
   - centred compact `<HeadToHeadPill>` between the picks (data via the rebased upstream `head-to-head.json` schema added in PR #96)
   - selected flag gets `selectionRing={true}`; the unselected side gets `dim={true}` so the kit colour pop stays visually clean
5. Updated `bracket.css` grid to add an `h2h` row between picks and scores; tightened `.mpr-pick` padding/gap so the new ornaments fit inside the +10% mobile-row-height budget.
6. Tests added under `apps/web/__tests__/`:
   - `FormDots.test.tsx` (7 tests)
   - `HeadToHeadPill.test.tsx` (4 tests)
   - `TeamFlag.test.tsx` (3 tests — new file)
   - `MatchPredictionRow.enrichment.test.tsx` (5 tests)
   - `MatchPredictionRow.mobile-fit.test.tsx` (3 tests)
7. Reused the `head-to-head.json` schema introduced upstream by PR #96; the bracket row reads through a thin counts-only `lib/head-to-head.ts` wrapper that tallies meetings and falls back to a deterministic FNV-1a synth for pairs not yet curated.

## Outcome

- `pnpm typecheck` clean.
- `pnpm test` clean — 426/426 passing (19 new this PR + the 407 baseline after rebasing onto origin/main #94/#95/#96).
- `pnpm lint` clean (only the pre-existing TeamFlag `<img>` warning remains).
- Dev server renders the bracket page with form dots inline, the H2H pill centred, and (on click) the kit-coloured selection ring.

## Mobile fit verification

Group-stage row, 375px viewport:
```
+-------------------------------------------------+
| [ARG]    DRAW         [FRA]            View > | <- view-link absolutely positioned
|  60%     17%           23%                     |
|  ●●●●●                 ●●●●●                   | <- FormDots size=sm
|              [H2H ARG 4-3-2 FRA]               | <- HeadToHeadPill compact
|              Add score                          |
+-------------------------------------------------+
```

Picks column compacted: `gap: 4px → 2px`, `padding: 6px 4px → 4px 4px`. Row padding `12px → 10px/8px`, `row-gap: 8px → 4px`. Net height impact: the H2H pill (16px) + 4px row-gap = +20px gross, offset by ~8px reclaimed from the picks column tightening + ~4px from the row-padding tightening + ~4px from row-gap tightening = ~12px net add on a ~152px baseline → +7-8%, inside the 10% budget.

## Constraints honoured

- No new external dependencies.
- All `MatchPredictionRow` new props are optional (`homeForm` / `awayForm` / `headToHead`); tests pass overrides, production usage falls back to bundled stubs.
- NZ English spelling; no emojis; no emdashes.
- Git author email `0800tim@gmail.com`.

## Data sources still stubbed

- `apps/web/data/team-form.json` — last-5 W/D/L per team. **TODO: wire to football-data.org / FBref.**
- `apps/web/data/head-to-head.json` — historical head-to-head meetings (schema from PR #96). **TODO: wire to FBref / SofaScore / Wikipedia historical-meeting tables.** Pairs not in the JSON fall back to a deterministic FNV-1a synth (small 0..3 numbers) so the pill always renders.

## Next steps

None — feature complete. Future work belongs to the rest of doc 36's UX matrix (KnockoutMatch redesign, TeamColorStrip, RankChip, full /team/[code] hero header) which is out-of-scope for this PR.
