# 2026-05-10 — Competitor UX dossier and VTourn UX redesign spec

**Agent**: ux-research
**Branch**: `docs/competitor-ux-dossier`
**Status**: ready-for-review

## Task

Produce a deep competitive dossier on the best prediction-game and football-data web/app experiences, then synthesise a concrete UX specification VTourn can implement against. Two deliverables:

1. `docs/35-competitor-ux-dossier.md` — long-form research notes with citations.
2. `docs/36-vtourn-ux-spec.md` — synthesised redesign spec for `/team/[code]`, `/match/[id]`, group cards, knockout cards, leaderboard.

## Filename note

The original prompt called for `docs/24-` and `docs/25-` but those numbers are already taken by `24-gamification-and-virality.md` and `25-keys-and-secrets-required.md`. Used the next-free numbering convention (`35-`, `36-`) to avoid collision; pattern is consistent with the rest of the docs tree (the project already has 27a/27b/27c/27d split-numbering and a couple of duplicated 27/32 entries, so re-using 24/25 would have produced two files at the same number).

## Plan

1. Research targets via WebSearch + WebFetch: Telegraph Predictor, ESPN Bracket Predictor, Sky Bet Super 6, FotMob, OneFootball, FlashScore, BBC Sport, theScore, Polymarket, Kalshi, Sorare, Yahoo Pickem, Splash Sports.
2. For each, capture: hero/team-page layout, match cards, pick UX, knockout layout, leaderboard, onboarding, surprises, anti-patterns.
3. Write dossier with embedded ASCII wireframes and URL citations on every claim.
4. Write spec referencing existing components (`TeamFlag`, `MatchPredictionRow`, `BracketBuilder`, `KnockoutMatch`, `GroupCard`) so the next builder can extend rather than rewrite.
5. Conventional commit, push, open PR.

## Source code reviewed before writing

- `apps/web/components/bracket/TeamFlag.tsx` — existing flag component supports `rect`/`circle` shapes at `sm/md/lg/xl`; circle sizes 36/56/64/96 with sparkle and glow.
- `apps/web/components/bracket/MatchPredictionRow.tsx` — two-flag-plus-DRAW pattern with kit-colour CSS variables and inline odds percentages.
- `apps/web/components/bracket/KnockoutMatch.tsx` — knockout variant, no draw, displays "TBD" until cascade fills slots.
- `apps/web/components/bracket/BracketBuilder.tsx` — owns prediction state, three tabs (groups / knockouts / lock).
- `apps/web/components/bracket/GroupCard.tsx` — six-match prediction list with computed standings and tiebreaker control.
- `apps/web/app/world-cup-2026/landing/_components/LeaderboardPreview.tsx` — pre-launch placeholder with Global / Country / Friends / Affiliate tabs.

## Outcome

Two new docs in the worktree:

- `docs/35-competitor-ux-dossier.md` (~4,400 words, 12 competitors covered, every claim cites a URL).
- `docs/36-vtourn-ux-spec.md` — concrete component specs, ASCII wireframes for mobile and desktop, prioritised punch-list (S/M/L), north-star sentence.

Top three highest-impact recommendations (also called out in the PR body):

1. Add a `/team/[code]` page (currently missing) with kit-coloured gradient header, big circular flag, FIFA-rank chip, last-5 form dots, head-to-head pill, and squad grid. Single biggest unlock for SEO and shareable team pages.
2. Enrich the existing `MatchPredictionRow` with a head-to-head pill, last-5 form dots per side, and a kit-coloured selection ring on the chosen flag. Reuses `TeamFlag` and the existing `--mpr-home-accent` / `--mpr-away-accent` CSS variables.
3. Add a `/match/[id]` enrichment screen mirroring FotMob's tab pattern (Facts / Stats / Lineups / H2H / Predict) with a momentum bar, xG split and the existing live-odds chip embedded.

## Next steps

- Builder agent to take spec doc 36 and ship the Small punch-list items first (form dots, H2H pill, selection ring) — all reuse existing components and accent vars.
- Then `/team/[code]` page (Medium effort).
- Then `/match/[id]` enrichment (Large effort, multi-tab).

## Links

- PR: (added after `gh pr create` step)
- Related: docs/15-vtourn-brand-and-positioning.md, docs/16-game-modes-and-scoring.md, docs/24-gamification-and-virality.md, docs/30-gamification-and-affiliate-spine.md.
