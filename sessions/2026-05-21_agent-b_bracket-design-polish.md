# Agent B, bracket prediction page design polish

Date: 2026-05-21
Branch: worktree-agent-a1808ad8226037a82
Status: in-progress

## Task

Take the bracket page from "functional with editorial H1" to a polished
predictor that does not read like a SaaS form. Four jobs:

1. Stage-as-page mobile IA (each tab a swipeable screen on phones).
2. Elevated gold selection (4px ring + 12-16px halo + dim siblings on pick).
3. GSAP cascade pulse when an upstream pick newly populates a downstream slot.
4. Fraunces small-caps group labels + desktop row density + repositioned
   ellipsis + quieter "Add score" toggle.

## Files in scope (`apps/web/` only)

- `components/bracket/BracketBuilder.tsx`, `MatchPredictionRow.tsx`,
  `KnockoutMatch.tsx`, `GroupCard.tsx`.
- `app/world-cup-2026/bracket.css`.
- `package.json` (gsap dep), `__tests__/bracket-tabs.test.tsx` if assertions
  change.

## Decisions

- The codebase uses URL hash routing (`#qf`, `#sf` …), not `?tab=`. Existing
  deep-linking contract is preserved; the prompt's `?tab=` was a misread.
- Stage-as-page implemented as a horizontal scroll-snap carousel that only
  engages at `<= 768px`; on desktop the existing single-stage tab panel
  rendering is preserved. Tabs still drive the active stage via scroll
  programmatic animation; horizontal swipe between siblings is native CSS
  scroll-snap with a JS sync to keep tab state coherent.
- Gold elevation uses `box-shadow` for the 4px ring + 12-16px halo so we keep
  layout stable (no border thrash). Sibling dim extended to group rows via
  the existing `.is-dim` class which `MatchPredictionRow` already sets.
- GSAP cascade pulse: install `gsap` as a runtime dep and use the core
  package only (no plugins). Hook lives in `lib/bracket/use-cascade-pulse.ts`
  and animates `data-match-id` cells. Reduced-motion = no-op.
- Fraunces group labels: applied to `.bracket-group-head h3` only. Density
  pass: tightened `min-height` and `padding` on `.mpr-row`, repositioned
  `.mpr-view-link` to bottom-right with lower contrast, "Add score" toggle
  shrunk to mono caption beneath the row.

## Verification

`pnpm typecheck` before each commit. Test suite: targeted `bracket-tabs`
and any tests asserting markup the work changes.

## Outcome

(filled in at sign-off)
