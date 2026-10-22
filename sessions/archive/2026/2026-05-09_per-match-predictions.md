# 2026-05-09 — per-match-predictions rewrite

**Task**: replace the "drag teams to top of group" UX with per-match
predictions for every group-stage match. Standings are computed from the
predictions; tiebreaker control surfaces only when standings genuinely
tie.

**Branch**: `feat/per-match-predictions` (from `origin/main` via
`feat/team-flags-sparkle` for the TeamFlag component).

**Status**: complete; PR ready.

## What shipped

### Engine (`packages/bracket-engine`)

- New types in `src/tournament.ts`:
  - `MatchPrediction` — `{ matchId, outcome, homeScore?, awayScore?, lockedAt }`.
  - `GroupTiebreaker` — `{ groupId, rankedTeams[4], setAt }`.
  - `Bracket` — full per-match draft model.
  - Extended `Team` with optional `kit` and `flag_emoji`.
- New module `src/standings.ts`:
  - `computeGroupStandings(groupId, tournament, predictions, tiebreaker?)`.
  - `detectTiesNeedingTiebreaker(standings, options?)` for the UI.
  - `isGroupComplete(groupId, tournament, predictions)`.
  - Sort: points → goal-diff → goals-for → head-to-head → user tiebreaker.
- Extended `src/score.ts` with the docs/30 formula:
  - `BASE_POINTS` constants (group_outcome=50, exact_score=200, placements,
    knockout rounds 200/400/800/1500/3000).
  - `lockMultiplier(secondsSinceLock, windowSeconds)` per
    `1.0 + 4.0 × exp(-3 × t/window)`, clamped to [1.0, 5.0].
  - `contrarianMultiplier(impliedAtLock)` — table from docs/30.
  - `scoreGroupMatchPrediction`, `scoreKnockoutMatchPrediction`,
    `scoreGroupPlacement`.

### Web (`apps/web`)

- Rewrote `components/bracket/GroupCard.tsx` — 6 match rows + live
  computed standings panel + inline tiebreaker control.
- New `components/bracket/MatchPredictionRow.tsx` — segmented
  Home/Draw/Away buttons with kit-colour highlight, optional collapsible
  score input, full keyboard support (1/2/3 + arrow keys).
- New `components/bracket/KnockoutMatch.tsx` — knockout cell with no
  draw option (winner only); shows "TBD" until upstream slots are filled.
- Rewrote `components/bracket/BracketBuilder.tsx` with three tabs:
  group stage / knockouts / lock + share.
- Updated `lib/bracket/storage.ts` to v2 schema (per-match `Bracket`).
- Updated `lib/bracket/submit.ts` payload shape.
- New `lib/bracket/cascade-bridge.ts` — converts the per-match `Bracket`
  to the legacy `BracketPrediction` the cascade engine consumes (so the
  knockout-tree slot-filling keeps working without rewriting cascade).
- New `lib/bracket/enrich.ts` — merges `data/fifa-wc-2026/teams.json`
  (kit colours + flag emojis) onto the engine's tournament teams.
- Extended `app/world-cup-2026/bracket.css` with styles for the new
  components (segmented buttons, standings panel, tiebreaker pill,
  knockout grid, tabs).

### Tests

- `packages/bracket-engine/test/standings.test.ts` — **24 tests**:
  counting basics, primary-metric sort order, head-to-head, three-way
  ties, all-draw paths, exact-score data path, determinism, tiebreaker
  resolution.
- `packages/bracket-engine/test/score.test.ts` — extended by **17 tests**
  to cover `BASE_POINTS`, `lockMultiplier`, `contrarianMultiplier`, and
  `scoreGroupMatchPrediction` / `scoreKnockoutMatchPrediction` /
  `scoreGroupPlacement`.
- `apps/web/__tests__/per-match-prediction.test.tsx` — **6 integration
  tests** with React Testing Library (renders all 12 groups, clicking
  outcomes updates the standings panel live, persists to localStorage,
  hydrates from localStorage, switches between tabs).
- `apps/web/__tests__/e2e/per-match-prediction.e2e.spec.ts` — Playwright
  spec for when `@playwright/test` is added to the monorepo (currently
  excluded from vitest + lint via `.eslintignore`).

### Final tallies

```
pnpm test       → all suites green
                  bracket-engine: 92 tests (was 51, +41)
                  web:           68 tests (was 62, +6)
pnpm typecheck  → clean
pnpm lint       → only the pre-existing TeamFlag <img> warning
```

## What didn't change

Per the constraint list:

- Renderer (`MatchScene`, `Pitch`, `Player`, etc.) — untouched.
- Producer + commentary — untouched.
- `cascade.ts` and `vstamp.ts` engine modules — untouched (the bridge
  layer in `apps/web/lib/bracket/cascade-bridge.ts` adapts the new
  per-match `Bracket` into the legacy `BracketPrediction` shape).
- `BracketTree.tsx` — left in place but no longer rendered. The new
  knockouts tab uses `<KnockoutMatch>` instead. Tree can be deleted in a
  follow-up PR once the design is signed off.

## Open

- `@playwright/test` is not installed; the spec under
  `apps/web/__tests__/e2e/` documents the assertions but doesn't yet
  run. Following PR should add the dep + a CI job.
- `<AffiliateCTA>` and `<OddsChip>` weren't found in the tree, so the
  per-match row doesn't yet show market-implied odds beside the buttons.
  Wire-in target: when the Polymarket integration (docs/29) lands, the
  segmented buttons can show implied % beneath each option.
