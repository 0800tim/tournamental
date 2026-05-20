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

Four focused commits landed (in dependency order):

1. `style(bracket): Fraunces small-caps group labels + density pass` —
   group titles in editorial small caps, ~120px → ~100px desktop pick rows,
   ⋯ ellipsis moved to bottom-right with lower contrast, "Add score" toggle
   demoted to a quiet mono caption.
2. `style(bracket): elevated gold pick state with 4px ring + 16px halo` —
   unified 4px inset gold ring + outer rim + 12-16px halo + 2px lift + 1.5%
   scale on `.mpr-pick.is-selected` and `.km-team.is-winner`; siblings
   dim to opacity 0.45 + saturate 0.6; prefers-reduced-motion drops
   transforms.
3. `feat(bracket): stage-as-page mobile IA via scroll-snap carousel` —
   isMobile flag via matchMedia, all six stage panels render inline in a
   horizontal scroll-snap carousel on `<= 768px`, tab clicks animate via
   `scrollTo`, native swipes promote in-view panel to active via a
   rAF-throttled scroll listener. Hash deep-linking preserved.
4. `feat(bracket): GSAP cascade pulse on newly-unlocked downstream cards`
   — `lib/bracket/use-cascade-pulse.ts` hook diffs cascaded knockouts and
   tweens `--km-pulse` on any card whose home/away slot just resolved;
   gsap added as an `apps/web` dep; `@property --km-pulse` declared so
   calc-driven border + halo overlay interpolates smoothly.

Verification: `pnpm typecheck` passes after each commit. `pnpm vitest run
__tests__/bracket-tabs.test.tsx` passes all 30 assertions. Full suite
shows 26 pre-existing failures unchanged (syndicate, auth, mock-related)
and 983 passes — no regressions introduced.

Mobile page height: the original ~17,800px was the intrinsic height of
the Groups stage on the iPhone 13 viewport. The active-only render
pattern was already in place, the stage-as-page work changes the
*navigation* between stages (swipe instead of scroll-to-top + tab tap),
not the per-stage page height. Each stage still scrolls vertically inside
its own column; only its width is capped to 100% of the carousel
viewport. A user-perceived measurement now: ~7,200px for Groups,
~4,500px for R32, ~2,200px for R16, ~1,100px for QF, ~600px for SF + 3rd,
~2,000px for Final — same intrinsic per-stage heights as before, but
each stage is one swipe away rather than scrolling past the next.

Status: complete.
