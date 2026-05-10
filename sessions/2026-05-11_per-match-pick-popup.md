---
agent: per-match-pick-popup
status: in-progress
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

(filled in at sign-off)

## Next steps

(filled in at sign-off)
