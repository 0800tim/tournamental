# 2026-05-10 — Marketing light-mode builder — full readability pass

Status: ready-for-review

## Task

Walk every page and component of `apps/marketing` and make sure the
site reads beautifully in both light and dark mode after PR #74 landed
the foundational theme system. Refine the per-page edge cases that
PR #74's blanket overrides missed, expose a stable hook for testing,
and back the work with a Playwright spec that screenshots every page
in both themes and asserts heading contrast.

PR #74 (just merged) had:
- `:root` / `:root[data-theme="light"]` token system in globals.css.
- Pre-paint script + 3-state header toggle (system / light / dark)
  driven by `localStorage["vtourn:theme"]`.
- Blanket `text-white`, `text-ink-*`, `bg-ink-*`, `border-ink-*`
  overrides for the light theme.
- Inline critical styles in Layout.astro `<head>` to kill the FOUC
  while the external CSS module loads in dev.

This pass picks up where that left off.

## What landed

### Per-page refinements (`globals.css`)

- Defined the missing `.btn-secondary` class. Three pages (index,
  world-cup-2026) reference it as a tertiary CTA but it had no
  styles — it was rendering as plain bold text. Now it's a sky-blue
  outlined button that fills on hover.
- Bumped `text-accent-400` informational labels to `accent-600` in
  light mode so the eyebrow text on cards and the "Open the live
  replay" call-out don't wash out on white. Brand fills
  (`bg-accent-500` on `.btn-primary`) stay untouched.
- `text-flame-400` steps to `flame-600` for the same reason.
- Hero radial-glow opacity bumped (10/6 % → 18/10 %) and shifted to
  `accent-600` / `flame-600` stops in light mode. The original 10/5 %
  values washed out completely against the lighter page background;
  the new tone reads as a subtle brand halo on white.
- `bg-ink-900/60` and `bg-ink-900/80` now resolve to the light page
  bg (the Footer was carrying `bg-ink-900/60` and reading dark-on-
  light before; same fix benefits any future overlay using the
  900-with-opacity pattern).
- Open-source banner gradient (`from-ink-800 to-ink-900` on
  index.astro) now lightens correctly; its `border-accent-700/60`
  frame and `bg-accent-700/10` fill are nudged to higher contrast
  so the banner doesn't blend into the surrounding white.
- Hero match-card carve-out: marked the AR-FR preview tile with a
  new `vt-on-dark` token. The tile keeps its
  `from-emerald-600 → via-emerald-500 → to-accent-700` gradient in
  both themes (it's a faux video preview, that's brand) but its
  inner `text-white` / `text-ink-200` / `text-accent-400` / `text-flame-400`
  copy is force-pinned to white-on-dark instead of inheriting the
  light overrides. The gradient itself is also strengthened to
  70/45/70 % opacity in light mode so the white text still pops
  against it.

### Layout + e2e hooks (`Layout.astro`)

- Added `data-themed` to `<html>`. Astro 4 strips static `<html>`
  attributes during build minification (HTML5 says they're optional),
  so the attribute set on the literal element disappears from
  `dist/`. The pre-paint script now sets it on `documentElement`
  alongside `data-theme`, so the DOM exposes it for tooling.
- Pre-paint script gained a `?theme=light|dark` query-string
  override (used by the e2e spec to deep-link a theme without
  touching localStorage from the test harness).

### Hero + SectionHeading (`Hero.astro`, `SectionHeading.astro`)

- Hero match-card container picks up the `vt-on-dark` class.
- Fixed a pre-existing typecheck error in SectionHeading where
  `class:list={cond && "..."}` could resolve to `false`, which
  Astro types reject. Refactored to the array form
  `class:list={["...", cond && "..."]}` which Astro accepts.

### Tests (`playwright.config.ts`, `e2e/light-mode-readability.spec.ts`)

- New Playwright config gated on `RUN_MARKETING_E2E=1`. Without the
  env var the spec skips (CI without browsers stays green).
- The spec walks all 11 routes in both themes (22 cases) and:
  1. Pins `localStorage["vtourn:theme"]` to the theme under test
     before navigation (the header toggle re-applies localStorage
     on script load — without this it would clobber the `?theme=`
     URL override).
  2. Visits `<route>?theme=<theme>`.
  3. Asserts `data-theme` and `data-themed` are set on `<html>`.
  4. Screenshots full-page to
     `apps/marketing/e2e-screenshots/<route>-<theme>.png`.
  5. Computes the WCAG 2.1 contrast ratio between the first
     visible heading's computed `color` and its effective ancestor
     bg. Fails if < 4.5:1 (the AA threshold for body text — large
     headlines should comfortably clear it).

### DX

- Added `@astrojs/check`, `typescript`, and `@playwright/test` as
  marketing devDependencies (typecheck + e2e). PR #74 didn't add
  the `@astrojs/check` dep so `pnpm typecheck` was prompting for
  it interactively.
- Added `apps/marketing/e2e-screenshots/`, `test-results/`, and
  `playwright-report/` to the root `.gitignore`.

## Verified

- `pnpm typecheck` — 0 errors / 0 warnings (2 deprecation hints
  pre-existing from PR #74's `mq.addListener` fallback).
- `pnpm build` — 11 pages built clean.
- `pnpm preview` + `RUN_MARKETING_E2E=1 pnpm exec playwright test`
  — 22 / 22 passing; every page hits >= 4.5:1 heading contrast in
  both themes.
- Manual visual review of all 22 screenshots — every page reads
  cleanly in both themes; no remaining unrecoverable surfaces.

## Pages touched

All 11 pages were reviewed; none required source-level changes
because the override layer + new `btn-secondary` definition cover
their cases. Direct edits:

- `src/styles/globals.css` — tokens + components + overrides
- `src/layouts/Layout.astro` — pre-paint script, `data-themed`
- `src/components/Hero.astro` — `vt-on-dark` on match-card
- `src/components/SectionHeading.astro` — typecheck fix
- `apps/marketing/package.json` — devDependencies
- `apps/marketing/playwright.config.ts` — new
- `apps/marketing/e2e/light-mode-readability.spec.ts` — new
- `.gitignore` — playwright artefacts

## Out of scope (parked)

- Light-mode OG cards. The brand assets stay dark — light variants
  can be added later if Tim wants them.
- Light-mode favicon. The current SVG is theme-neutral so it works
  in both.

## Next steps

None on this branch — ready to merge.
