# 2026-05-09 — Bracket-Engine Builder, Initial Build

**Status**: in-progress
**Agent**: bracket-engine-builder
**Branch**: `feat/bracket-prediction-engine`
**Base**: `origin/main` @ `fbfac4c`

## Task

Build the client-side bracket-prediction engine for VTourn's flagship 2026 FIFA World
Cup launch. New workspace package `packages/bracket-engine`, plus a UI surface, plus
2026 fixtures vendor data, plus tests, plus OG-image generation for share cards.

## References

- `docs/24-gamification-and-virality.md` — predict → watch → win → share loop.
- `docs/16-game-modes-and-scoring.md` — canonical scoring formula (the early-lock
  long-shot mechanic comes from `base_points = 100 * (1 - market_implied_at_lock)`
  combined with the time multiplier).
- `docs/26-platform-strategy-and-syndicates.md` — *exists on `feat/commentary` branch
  only* (PR #29 not merged). Read it on that branch for context.
- `packages/spec/src/index.ts` — canonical `MatchInit` / `StateFrame` /
  `EventMessage` types. Not modified.

## Plan

1. New workspace package `packages/bracket-engine` with pure-function engine:
   - `Tournament`, `BracketPrediction`, `cascade`, `score`, `signBracket` (VStamp v0.1).
   - 25+ vitest tests.
2. Vendor `data/fifa-wc-2026-fixtures.json` — placeholder draw with `_meta` source
   block; structured so a real-draw JSON drop replaces it without code changes.
3. Bracket UI surface: **`apps/web` Next.js route** at `/world-cup-2026/bracket`.
   Chosen over `apps/marketing` because:
   - `apps/marketing` does not exist on `origin/main` yet (it's on PR #30).
   - `apps/web` ships in main; no other in-flight branch touches a top-level route.
   - I avoid all renderer files (`Player.tsx`, `MatchScene.tsx`, `Pitch.tsx`,
     `Ball.tsx`, `Stadium.tsx`, `CameraRig.tsx`, `Players.tsx`) — owned by the
     fidelity agent on `feat/timeline-scrubber-and-fidelity`.
   - Marketing site can link to the renderer-side URL once PR #30 merges.
4. Server-side OG image generation via `satori` + `@resvg/resvg-js`. PNGs cached at
   `apps/web/public/og/bracket/<bracket_id>.png`. Page emits OG meta tags pointing at
   each user's specific share image.
5. `apps/api` POST stub (warning + console + localStorage) — real endpoint will be
   landed by the API agent on PR #27 / future.

## Open questions for the orchestrator

- Server signing key for VStamp: documented as TODO `BRACKET_VSTAMP_SIGNING_KEY` in
  `apps/api/.env` (when the API service lands). For v0.1, the bracket UI uses a
  placeholder envelope; the engine API surface accepts `signerKey` so it can be
  wired in later.
- Real 2026 WC draw: not finalised at time of build. Placeholder slots used; swap
  to real teams when FIFA publishes.

## Outcome

(filled in at end of session)
