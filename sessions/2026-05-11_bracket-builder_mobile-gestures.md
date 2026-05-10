# 2026-05-11 — bracket mobile gestures

**Task**: ship mobile-first gestures on the WC-2026 bracket page —
pinch-zoom on the knockouts grid, sticky group headers on the
group-stage tab, and haptic feedback on every pick. Plus a
scroll-to-fix nicety when an upstream pick changes a downstream
knockout slot off-screen.

**Branch**: `feat/bracket-mobile-gestures` (from `origin/main`).

**Status**: complete; PR ready.

## What shipped

### New utility module: `apps/web/lib/bracket/mobile-gestures.ts`

All gestures live in a single, tree-shake-friendly module.

- `usePinchZoom(options)` — two-finger pinch + double-tap zoom on a
  container. Returns callback refs for the touch-capture container
  and the scaled target. Scales between 0.7x and 1.6x; double-tap
  toggles 1.0x ↔ 1.2x. Transform-origin is pinned to the midpoint of
  the two fingers so the zoom feels anchored. Single-finger drags pass
  through to the inner `.km-grid` horizontal scroll. `touchmove` is
  the only non-passive listener (it has to call `preventDefault` to
  stop the page-level pinch); `touchstart` / `touchend` stay passive.
- `useStickyGroupHeaders(options)` — adds `is-stuck` to elements
  matching `headerSelector` when a 1px sentinel inserted before each
  header scrolls off the top of the viewport. Pure
  IntersectionObserver; no scroll listener.
- `vibrate(pattern)` + `useHaptic()` — wraps `navigator.vibrate`,
  no-ops on missing API and on `prefers-reduced-motion: reduce`.
- `scrollIntoViewIfHidden(el)` — smooth-scrolls only when the
  element is currently off-screen; respects reduced-motion.

All hooks are mobile-only: gated on `(max-width: 640px)` matchMedia.

### `BracketBuilder.tsx` wiring

- Group-stage grid wrapped with `useStickyGroupHeaders` ref so each
  `Group A`/`Group B`/... header sticks while scrolling that group's
  matches into view.
- Knockouts grid wrapped in a `.km-pinch-wrap` container that owns
  the pinch handler; the inner `.km-grid` is the scaled target.
- `onChangeMatch` fires `HAPTIC.pick` (= `8`) when the outcome
  actually changes. `onChangeKnockout` fires the slightly-longer
  `HAPTIC.cascadeResolved` (= `[8, 30, 8]`) because a knockout pick
  always resolves a downstream slot.
- New cascade-watcher effect: when `cascaded.knockouts` changes after
  a pick, find the first downstream card whose home/away slot
  changed identity and `scrollIntoViewIfHidden` it.

### CSS additions: `apps/web/app/world-cup-2026/bracket.css`

- `.km-pinch-wrap` — touch-capture surface; `touch-action: pan-x
  pan-y` so single-finger pans still scroll the grid sideways.
- Mobile-only sticky `.bracket-group-head` with `position: sticky;
  top: 0`; `.is-stuck` class adds a soft drop shadow + bottom border.
- `.km-grid` gets a 80ms scale transition for snappier pinch feedback.

### Tests: `__tests__/bracket-mobile-gestures.test.tsx`

9 new tests, all green:
- Pinch container: `.km-pinch-wrap` wraps `.km-grid`, target gets
  `transform-origin` and `will-change: transform` after mount.
- `vibrate()`: pattern pass-through, prefers-reduced-motion no-op,
  missing-API graceful fallback.
- BracketBuilder: clicking a group pick calls `navigator.vibrate(8)`.
- `useStickyGroupHeaders`: synthesized IntersectionObserver entries
  flip `is-stuck` on/off correctly.
- `scrollIntoViewIfHidden`: scrolls when off-screen, no-ops when
  visible.

Total suite: **393 / 393 pass** (was 384 before this PR).

## Verification steps

- `pnpm typecheck` — clean.
- `pnpm test --run` — 393 / 393 pass.
- `pnpm lint` — only pre-existing `no-img-element` warning on
  `TeamFlag.tsx`; nothing from this PR.
- Manual: open `/world-cup-2026/bracket` in Chrome DevTools at a
  375px viewport. Group-stage tab → scroll down inside a group; the
  `Group A` header pins to the top with a shadow. Knockouts tab →
  two-finger pinch zooms the grid; double-tap toggles 1x ↔ 1.2x.
  Pick a flag → "Force Touch" / vibration log fires `8`. Pick a
  knockout winner → fires `[8, 30, 8]`.

## Accessibility considerations

- Zoom does not change focus order; keyboard navigation of the
  underlying buttons is unaffected because we never `pointer-events:
  none` the scaled content.
- Haptic feedback is opt-out via `prefers-reduced-motion: reduce` —
  the OS-level setting is honoured without an in-app toggle.
- Sticky headers don't trap focus (no `tabindex` change).

## Out of scope (parked in IDEAS.md if it grows)

- Full Playwright e2e test for real multi-touch.
- Pinch-to-zoom on the SVG bracket-tree visualisation in
  `BracketTree.tsx` (separate component, not on the prediction
  builder critical path).
- Per-pick custom haptic patterns beyond the two defined here.
