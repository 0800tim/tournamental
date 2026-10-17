# 2026-10-17, accessibility audit and fixes: hub, archive, shell

**Task**: burn round 4, accessibility audit of the surfaces from PR #333 with fixes and component tests.
**Branch**: `fix/a11y-hub-archive-shell` (worktree, from main).

## What changed

- `docs/reviews/2026-10-accessibility-hub-archive-shell.md`: 15 findings, all fixed; contrast table (every pair passes AA, computed from the stylesheet).
- `app/hub/RegisterInterestForm.tsx`: errors tied to their field (`aria-invalid`, `aria-describedby`), `aria-required`, country hint, honeypot as a hidden group, `aria-busy` on submit, focus moves to the thank-you heading, new-tab hints, named Copy and More buttons, copied live region. `fieldFor()` exported.
- `components/ui/CountdownBanner.tsx`: `role="timer"` with a minute-granular `aria-label` instead of a per-second `aria-live` region; grid `aria-hidden`; `summaryFor()` exported.
- `components/shell/AppMenuDrawer.tsx`: dialog role on the panel, focus to the close button on open, Tab trap, focus returned on close, new-tab hints on external links.
- `components/shell/BottomNav.tsx` and `AppShell.tsx`: `menuOpen` prop, `aria-expanded` on the menu button.
- `app/archive/page.tsx` and new `lib/archive/labels.ts`: distinct names for every knockout "Match" link, flag emoji hidden from speech.
- `app/globals.css`: `.vt-sr-only` utility.
- Tests: `__tests__/a11y/` (21 cases, self-contained intl wrapper so they pass on main today).

## Checks

vitest 21 passed, eslint clean (one pre-existing img warning), tsc clean on the changed files.

## Conflicts to expect

`app/archive/page.tsx` also changes in PR #343 (round of 32, stage labels moved to `lib/archive/final-standings.ts`). Both touch the knockout list; the resolution is to keep `knockoutLinkLabel(KNOCKOUT_STAGE_LABEL[s] ?? s, ...)` and `knockoutScoreText(k)`. Merge #343 first.

## Needs Tim

Review and merge after #343; build and restart `tournamental-web`; a browser pass on bigmac (axe and a keyboard walk of hub, archive and the drawer).
