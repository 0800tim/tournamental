---
agent: shell-agent
task: PWA app shell — bottom nav, top app-bar, pill tabs, hero cards, installable manifest
status: ready-for-review
branch: feat/web-pwa-app-shell
date: 2026-05-11
---

# PWA app shell — sessions note

## Plan
1. Build shell primitives in `apps/web/components/shell/`: `AppBar`, `BottomNav`, `SideRailNav`, `PillTabs`, `AppShell`, `InstallPrompt`.
2. Build UI primitives in `apps/web/components/ui/`: `HeroCard`, `CountdownBanner`, `MatchCard`, `PillChip`, `NewsCard`, `StoriesStrip`.
3. PWA: `manifest.webmanifest`, `sw.js`, `<link rel="manifest">` in `app/layout.tsx`, install prompt component.
4. PWA icon generator script: `apps/web/scripts/generate-pwa-icons.ts` — emits 192/256/384/512 standard + maskable.
5. Re-shell pages: `app/page.tsx` (home feed), `app/world-cup-2026/page.tsx`, `app/match/[id]/page.tsx`, `app/team/[code]/page.tsx`. Add stub `app/profile/page.tsx`, `app/leaderboard/page.tsx`, `app/predict/page.tsx`, `app/watch/page.tsx`.
6. Vitest tests for AppShell, AppBar, BottomNav, PillTabs, MatchCard.
7. Doc: `docs/37-pwa-app-shell.md`.

## Key decisions
- CSS-variable theme with `data-theme="dark|light"` switch on `<html>`. No CSS-in-JS.
- The match renderer page keeps full-bleed canvas; shell overlays a translucent app-bar at top, no bottom nav (`showBottomNav={false}`).
- Bottom-nav routes: Home `/`, Predict `/world-cup-2026`, Watch `/watch`, Profile `/profile`. Optional centre `Syndicates` reserved but not wired in v0.1.
- Service worker is opt-in registered from a small client-only `RegisterSW` component to avoid breaking SSR.

## Out of scope (see IDEAS.md)
- Real auth flow for profile.
- Real leaderboard data — mocked.
- Push-notification subscription persistence.

## Outcome
- Shell + UI primitives shipped under `apps/web/components/shell/` and `apps/web/components/ui/`.
- PWA manifest, service worker, and 6 generated icons (192/256/384/512 + maskable 192/512) live under `apps/web/public/`.
- Five new routes wired: `/profile`, `/leaderboard`, `/watch`, `/predict` (redirects), and the existing `/`, `/world-cup-2026`, `/match/[id]`, `/team/[code]` are now wrapped in `<AppShell>`.
- 6 new vitest suites added (AppBar, AppShell, BottomNav, PillTabs, MatchCard, CountdownBanner) — all 405 tests pass.
- `pnpm typecheck` is clean.
- Manual smoke (next dev on :3500): `/`, `/world-cup-2026`, `/leaderboard`, `/profile`, `/watch`, `/team/ARG` all return 200 with the expected `vt-shell` / `vt-appbar` / `vt-bottomnav` / `vt-siderail` markers in the HTML.
- New doc: `docs/37-pwa-app-shell.md`.

## Pre-existing build issue (NOT this PR)
- `pnpm build` fails to prerender `/team/[code]` with "Cannot read properties of null (reading 'useContext')". Confirmed reproducible on `main` (verified via `git stash` + build) before any shell changes were applied. Tracked as a separate follow-up; out of scope for this PR.

## Next steps (follow-up PRs)
- Lighthouse PWA score harness in CI.
- Wire `apps/push-notifications` subscription to the service-worker push handler.
- Real auth on `/profile` (per docs/20, docs/32).
- Verified-pundit badges on `/leaderboard` once that PR lands.
