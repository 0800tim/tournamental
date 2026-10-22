---
agent: per-match-pick-popup
status: complete
date: 2026-05-11
docs:
  - docs/45-per-match-pick-popup-and-api.md (new)
  - apps/game/src/routes/bracket.ts (existing reference)
  - apps/web/components/bracket/MatchPredictionRow.tsx (existing reference)
---

# Per-match pick popup + per-match game API

## Goal

Tim wants to pick / change a single prediction without leaving the team page. Tap a fixture, get a popup; same component everywhere (team page, bracket grid, eventually social cards). Persist game-by-game so it doesn't re-encode the whole bracket.

## Plan

1. apps/game: PUT/GET/DELETE `/v1/picks/:userId/:matchId`.
   - Validates outcome by stage (no `draw` in knockouts → 422).
   - Validates kickoff lockout via the existing kickoff registry (≥ kickoff → 409).
   - Persists into the same `brackets.payload_json` shape the bulk submit uses (read-modify-write into `matchPredictions` or `knockoutPredictions`).
   - Idempotent; per-user/per-match rate limit; structured audit log.
2. apps/web: `MatchPickPopup` component + `useMatchPick` hook.
   - Sheet/modal/inline presentation.
   - W/D/L tri-state (knockout: hide draw); optional exact-score steppers.
   - Live-odds chip (when odds prop supplied) → expand summary on click.
   - Lock state past kickoff.
3. Wire popup into the team page fixtures + add "..." trigger to MatchPredictionRow.
4. URL deep-link: `/team/[code]?pick=<matchId>`, `/match/[id]?pick=open`.
5. Tests: ~7 in apps/game, ~12 in apps/web.
6. Doc: `docs/45-per-match-pick-popup-and-api.md`.

## Decisions

- Stage detection in the API: knockout match ids are non-numeric (e.g. `r32_01`, `final`); group match ids are numeric strings 1..72. Use a tiny helper rather than peeking into the kickoff registry.
- Per-match write rate limit: per-user `userId:matchId` token bucket via @fastify/rate-limit `keyGenerator`.
- Deep-link state: popup writes a `?pick=<matchId>` search param via `history.pushState` on open; closing pops it.
- Don't depend on the OverlayRouter primitive from the sibling agent (still in flight). Use a `<dialog>` for sheet/modal.

## Open questions

- None blocking.

## Outcome

Shipped:

- `apps/game`: PUT/GET/DELETE `/v1/picks/:userId/:matchId` with stage
  validation, kickoff lockout, owner-only auth, per-(user,match) rate
  limit, and structured audit log. Reuses `brackets.payload_json` so
  bulk submit and per-match writes remain interchangeable. Tests live
  in `apps/game/tests/per-match-picks.test.ts` (13 cases). Total
  game-app test count: 74 passed.
- `apps/web`:
  - `MatchPickPopup` component with sheet/modal/inline presentations
    in `components/match-pick/`.
  - `useMatchPick` hook (no SWR; manual fetch + reducer) with local
    draft fallback on network errors.
  - `TeamFixturesWithPicks` client component on the team page; each
    fixture row gets a Pick button that opens a sheet. URL
    `/team/[code]?pick=<matchId>` deep-link wired.
  - `MatchPredictionRow` gets a `⋯` trigger that opens the same popup.
  - `MatchPickOverlay` on `/match/[id]/preview` for `?pick=open`
    deep-link.
  - Tests in `__tests__/match-pick-popup.test.tsx` (12 cases). Total
    web-app test count: 445 passed.
- `docs/45-per-match-pick-popup-and-api.md`: full spec, error
  codes, deep-link scheme, forward-looking note about
  OverlayRouter integration.

Quality gates passed: workspace `pnpm typecheck`, both apps' test
suites, web lint (one pre-existing TeamFlag warning, unchanged).

## Next steps

- When sibling agent `feat/mobile-overlays-deep-links` lands the
  OverlayRouter primitive, replace the `MatchPickPopup`'s
  hand-rolled overlay/backdrop with that. The popup content
  component is already separated from the overlay shell.
- Add a long-press gesture on mobile to MatchPredictionRow that
  also opens the popup (currently only the `⋯` button does — fine
  on desktop, an extra ergonomic on phone).
- Cascade refresh: when a user changes a knockout pick via the
  per-match endpoint, recompute downstream knockouts client-side
  (the API already hints `cascade_refresh_hint: true`).
