# Session: odds-chip + hover tooltips on bracket page

- **Date**: 2026-05-10
- **Agent**: odds-chip-bracket-integration
- **Branch**: `feat/odds-chip-bracket-integration` (from `origin/main`)
- **Refs**:
  - `docs/30-gamification-and-affiliate-spine.md`
  - `docs/29-polymarket-odds-integration.md`

## Goal

Wire live W/D/L odds chips with hover tooltips into the bracket page so
users can see "Home 38% · Draw 25% · Away 37%" for every group-stage row
and "Home 62% · Away 38%" for every knockout match.

The real odds-ingest API is being built in parallel. Build a tier-fallback
client so the chip works today against a deterministic FIFA-rank-based
mock and switches to the real API when it's live.

## Plan

1. Add `apps/web/lib/odds/` — client (3-tier fallback), mock generator
   (deterministic from FIFA ranks), geo helper, and a `useMatchOdds`
   React hook.
2. Add `apps/web/components/odds/OddsChip.tsx`, `OddsHoverCard.tsx`, and
   `MarketTrend.tsx`.
3. Wire `<OddsChip>` into `MatchPredictionRow.tsx`, `KnockoutMatch.tsx`,
   and `GroupCard.tsx`.
4. Add Next.js stub routes under `apps/web/app/api/odds/...` that proxy
   to upstream when configured, otherwise return mock data.
5. RTL + Vitest unit tests; one Playwright E2E that hovers a row and
   asserts the tooltip rows sum to 100%.

## Constraints

- Do not break the 96 existing web tests or the 92 bracket-engine tests.
- No new heavy deps. CSS-only hover; no Radix needed.
- Keep MatchPredictionRow + KnockoutMatch a11y/keyboard intact.
- Geo-gate the affiliate CTA via `cf-ipcountry` server signal + a client
  hint passed from the page.

## Notes / decisions

- The package name is `@vtorn/web` (not `@vtourn/web`); brand-rename PR
  #41 left package names in the `@vtorn/*` namespace. Tests run via
  `pnpm --filter @vtorn/web test`.
- Match identity for group fixtures is `groupMatchId(f) = String(f.match_no)`
  (1..72). Knockouts use the engine's `f.id` (e.g. `r32_03`, `final`).
  Both can be passed to the odds client as `matchNo`.
- `data/fifa-wc-2026/teams.json` ships `fifa_ranking_at_2026` for every
  team — that's the input to the mock generator.
- API URL: `process.env.NEXT_PUBLIC_ODDS_API_URL` first; then
  `/api/odds/*`; then deterministic mock.
- Mock probabilities snap to W+D+L=1 with a small per-match-stable noise
  so the chip looks alive but doesn't flicker.

## Outcome

- **Tests**: 146/146 web tests pass (96 existing + 50 new). All
  package suites (`bracket-engine`, `social-cards`, `avatar`,
  `mock-producer`, `wc2026-producer`, `web`) pass for a workspace
  total of 413 tests.
- **Lint**: clean. Only the pre-existing `<img>` warning in
  `TeamFlag.tsx` remains.
- **Typecheck**: clean (`tsc --noEmit` on `@vtorn/web`).
- **Build (`next build`)**: pre-existing prerender failure on
  `/world-cup-2026` reproduced on `origin/main` without my changes —
  unrelated to this PR. CLAUDE.md's gating list is `lint + typecheck +
  test`; `next build` is not in scope.

## Files added

- `apps/web/lib/odds/`
  - `types.ts` — wire-shape types for the odds API.
  - `mock.ts` — deterministic FIFA-rank-based mock generator.
  - `client.ts` — three-tier fallback client (live → stub → mock).
  - `geo.ts` — Polymarket affiliate-CTA geo gating.
  - `hooks.ts` — `useMatchOdds(matchNo, ...)` polling hook.
  - `use-country.ts` — client-side Cloudflare-country resolver.
- `apps/web/components/odds/`
  - `OddsChip.tsx` — inline pill with hover/focus/long-press.
  - `OddsHoverCard.tsx` — popover with W/D/L bars + CTA.
  - `MarketTrend.tsx` — pure-SVG sparkline.
  - `GroupWinnerChips.tsx` — per-team group-winner mini chips.
  - `OddsChip.module.css` — chip + card styles.
- `apps/web/app/api/odds/`
  - `match/[matchNo]/route.ts`
  - `team/[code]/winner/route.ts`
  - `team/[code]/group/route.ts`
  - `snapshot/route.ts`
  - `country/route.ts`
- `apps/web/__tests__/`
  - `odds-mock.test.ts` (10 tests)
  - `odds-client.test.ts` (11 tests)
  - `odds-geo.test.ts` (12 tests)
  - `OddsChip.test.tsx` (13 tests)
  - `bracket-odds-integration.test.tsx` (4 tests)
  - `e2e/odds-chip-bracket.e2e.spec.ts` (Playwright spec, runs
    when `@playwright/test` is installed)

## Files modified

- `apps/web/components/bracket/MatchPredictionRow.tsx` — pass-through
  props (`groupLabel`, `kickoffIso`, `country`, `showOddsChip`),
  inline `<OddsChip>` between the buttons row and the score-input
  toggle.
- `apps/web/components/bracket/KnockoutMatch.tsx` — same chip below
  the home/away buttons (no Draw row).
- `apps/web/components/bracket/GroupCard.tsx` — header bar of
  per-team group-winner mini chips via `<GroupWinnerChips>`.
- `apps/web/components/bracket/BracketBuilder.tsx` — pulls country
  via `useCountry()` and passes through.
- `apps/web/app/world-cup-2026/bracket.css` — appended CSS for
  `.mpr-odds`, `.km-odds`, `.bracket-group-winner-chips` so the chip
  sits cleanly inside the existing match-row layouts.

## Behaviour when the real odds API is down

The chip never renders empty. The `fetchMatchOdds` client walks three
tiers and the deterministic mock always succeeds. From day 1 the
bracket page shows "MEX 52% · D 25% · KOR 23%"-style chips with
plausible numbers derived from the canonical FIFA rankings in
`data/fifa-wc-2026/teams.json`. When the odds-ingest service ships,
clients see real Polymarket numbers with no client code change — the
`source` field on the wire payload flips from `mock-fifa-rank` /
`mock-stub` to `polymarket`.

## Status

ready-for-review
