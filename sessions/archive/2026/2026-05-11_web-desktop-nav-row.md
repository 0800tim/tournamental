# 2026-05-11 — Desktop horizontal nav row inside AppBar

Status: complete

## Task

Tim's feedback on https://play.tournamental.com/: "have a menu bar on
desktop, it's frustrating to open the burger every time. Have the common
items (Predict, 3D Molecule, etc) there. Make sure login and profiles
are prominent. More items in a drop-down. Mobile is fine as-is."

PR #150 stripped the desktop side rail and went burger-only. Tim wants
the common nav items always visible on desktop without two clicks.

## Plan

1. Extract the canonical drawer link list into a shared module
   `components/shell/nav-links.tsx` so the drawer + new desktop bar
   share one source of truth.
2. Add a `DesktopNav` component rendered as a second row inside the
   AppBar on viewports >= 768px (hidden via CSS below that).
3. Add an `AuthChip` reading `useUser()` for the right-side
   Sign in / Profile pill.
4. Update `AppBar` to mount the new row + a `data-with-desktop-nav`
   attribute so the appbar height token expands on desktop.
5. Update `shell.css` for the new styles + accommodate the taller bar
   (microsite sub-nav `top` now tracks `var(--vt-shell-appbar-h)`).
6. Tests: vitest unit for `pickActiveLink` longest-prefix rule + the
   DesktopNav active-route highlight + the AuthChip default state.

## Decisions

- **PRIMARY inline links**: Predict, 3D Molecule, Save & share, Watch
  demo, Leaderboard. These are the 90% items.
- **MORE dropdown**: Home, Syndicates, Watch, Settings, Open source.
  Home is in the dropdown because the brand-mark already links home.
- **Auth chip**: links to /profile in both states (the /profile page
  already owns the SignupModal for guests). Avoids mounting a duplicate
  modal at the shell level and keeps the shell bundle small.
- **Active route logic**: `pickActiveLink` returns the longest matching
  prefix so `/world-cup-2026/molecule` highlights "3D Molecule", not
  "Predict". `matchPrefix: "__never__"` opt-out for hash-only targets
  (Save & share).
- **AppBar height**: `--vt-shell-appbar-h` is 56px on mobile, 104px on
  desktop (56 + 48 nav row). Canvas variant keeps 56px because it
  suppresses the nav row.

## Outcome

- pnpm --filter @vtorn/web typecheck: green
- pnpm --filter @vtorn/web build: green
- pnpm --filter @vtorn/web test: 1000/1003 pass; the 3 failures
  (AppMenuDrawer.test.tsx Save & share routing, Create a syndicate
  sub-item, Syndicates external) are pre-existing on main and reference
  drawer items that don't exist yet. Out of scope.
- 7 new tests added (DesktopNav + nav-links).

## Files

- `apps/web/components/shell/nav-links.tsx` (new)
- `apps/web/components/shell/DesktopNav.tsx` (new)
- `apps/web/components/shell/AuthChip.tsx` (new)
- `apps/web/components/shell/AppBar.tsx` (updated)
- `apps/web/components/shell/AppMenuDrawer.tsx` (refactored to consume nav-links)
- `apps/web/components/shell/AppShell.tsx` (passes hideDesktopNav for canvas)
- `apps/web/components/shell/shell.css` (new styles + height-token plumbing)
- `apps/web/components/shell/index.ts` (re-export new modules)
- `apps/web/__tests__/DesktopNav.test.tsx` (new)
- `apps/web/__tests__/AppBar.test.tsx` (updated to current AppBar API)
- `apps/web/__tests__/AppBarBurgerViewports.test.tsx` (added required mocks; current burger class)
- `apps/web/__tests__/AppShell.test.tsx` (updated to drop showSideRail; assert nav row presence)
- `apps/web/__tests__/match-preview-page.test.tsx` (added usePathname mock)
- `apps/web/__tests__/team-detail-page.test.tsx` (added usePathname mock)
