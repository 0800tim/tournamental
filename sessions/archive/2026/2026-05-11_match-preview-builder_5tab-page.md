# 2026-05-11 — match-preview-builder — /match/[id]/preview 5-tab page

**status**: complete
**branch**: feat/match-preview-5tab
**docs**: 35-competitor-ux-dossier.md, 36-vtourn-ux-spec.md
**owner**: match-preview-builder

## Plan

1. Create `/match/[id]/preview` server component. Loads tournament, finds the match by id (group `match_no` or knockout id), renders hero + a client-side tabbed body.
2. Build five tab subcomponents on a single client component (`MatchPreviewTabs`):
   - Predict — embed `MatchPredictionRow`; show locked-in odds chip when picked.
   - H2H — historical meetings from `apps/web/data/head-to-head.json`.
   - Form — both teams' last-5 stacked side-by-side.
   - Lineup — predicted XI per team in formation, from `apps/web/data/team-formations.json`.
   - Stats — pre-match expected stats from `apps/web/data/team-stats.json`.
3. Add stub data files keyed by team/team-pair for deterministic rendering.
4. Wire up the bracket page: add a "View match" link on `MatchPredictionRow` and `KnockoutMatch`.
5. Tab state via URL hash with `role=tablist` and arrow-key cycle.
6. Vitest tests for server render + tab switching.

## Files added/edited

- `apps/web/app/match/[id]/preview/page.tsx` (new server component)
- `apps/web/app/match/[id]/preview/_components/MatchPreviewTabs.tsx` (client tabs)
- `apps/web/app/match/[id]/preview/_components/PredictTab.tsx` etc.
- `apps/web/app/match/[id]/preview/_lib/match-data.ts` (data loaders)
- `apps/web/app/match/[id]/preview/match-preview.css`
- `apps/web/data/head-to-head.json` (stub)
- `apps/web/data/team-formations.json` (stub)
- `apps/web/data/team-stats.json` (stub)
- `apps/web/components/bracket/MatchPredictionRow.tsx` (add small "View match" link)
- `apps/web/components/bracket/KnockoutMatch.tsx` (add "View match" link)
- `apps/web/__tests__/match-preview-page.test.tsx` (vitest)

## Open questions

None — spec covers everything.

## Outcome

- 12 new files, 3 small extensions to existing components.
- `pnpm typecheck` clean, `pnpm test --run` 395/395 pass (added 11 new
  tests in `__tests__/match-preview-page.test.tsx`).
- Dev server smoke: `/match/1/preview`, `/match/r32_01/preview`,
  `/match/final/preview` all return 200; unknown ids 404; existing
  `/world-cup-2026` continues to render.
- Stub data files carry explicit `_todo` markers for the live data
  source we'll wire next:
    - `head-to-head.json` → FBref / SofaScore / Wikipedia head-to-head
    - `team-formations.json` → FBref or SofaScore predicted-XI
    - `team-stats.json` → FBref season aggregates or internal xG model

## Next steps

- Wire live odds for the Predict tab via `/api/odds/snapshot?match=<id>`
  (currently the row reads from the BracketBuilder's bulk fetch — fine
  in the bracket page but the preview page renders without it).
- Replace stub data per the TODO list above.
- Add an OG image generator at `/og/match/[id].png` so social shares
  carry the kit-coloured hero.
