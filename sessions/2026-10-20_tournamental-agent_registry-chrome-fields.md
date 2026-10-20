# 2026-10-20, registry-driven chrome, steps 1 and 2

**Task**: burn round 7, steps 1 and 2 of `docs/design/registry-driven-tournament-chrome.md` (PR #346).
**Branch**: `feat/registry-chrome-fields`, stacked on `fix/web-vitest-suite` (PR #344) for its render helper, worktree.

## Step 1, fields with no behaviour change

`apps/web/lib/tournaments/registry.ts`: `code`, `routeBase` (required), `artDir`, `aliasHosts`, `marketingArchivePath` (optional) on `TournamentEntry`, filled for both entries (FWC2026 `/world-cup-2026`, aliases `wc2026` and `2026wc`, `/archive/fwc-2026`; RWC2027 `/rwc-2027`, art `/rwc2027/`). New `TournamentSummary`, `summarise()` and `chromeTournament()` (the active entry, or the newest archived one while nothing is active). The middleware constants that these fields will replace are untouched in this step.

## Step 2, the shell reads the registry

- `lib/archive/context.tsx`: `ShellModeState` gains `current` and `upcoming` summaries; `defaultShellMode()` fills them from the registry so a render with no provider behaves as live mode on the newest tournament; `ArchiveProvider` fills them too.
- `app/layout.tsx` sets `current` (archive entry, or the live chrome entry, or null on the hub) and `upcoming`.
- `components/shell/AppBar.tsx`: `wordmarkSub(shell)` builds "FWC 2026 archive", "RWC 2027 next" and "FWC2026" from the summaries.
- `components/shell/nav-links.tsx`: `rebaseLinks()`, `primaryDesktopFor()`, `moreDesktopFor()`, `drawerPrimaryFor()` swap the written `/world-cup-2026` prefix for a registry `routeBase`; `DEFAULT_ROUTE_BASE` comes from the registry; `forArchive()` takes the base. The exported lists are unchanged for today's base.
- `components/shell/AppMenuDrawer.tsx`: section labels from `current` and `upcoming`; hub archive rows from `archivedTournaments()`; primary links rebased on the current route base.

## Tests

`__tests__/platform/registry-fields.test.ts` (5) and `__tests__/shell-chrome.test.tsx` (8): fields, summary shape, chrome entry, the wordmark label per mode, rebasing, and the drawer rendered under explicit provider values for archive, hub and a live RWC base. The existing AppBar, AppMenuDrawer, DesktopNav, BottomNav, AppShell and burger tests pass unchanged: 49 in the run, under `systemd-run --user --scope -p MemoryMax=3G`. eslint and tsc clean.

## Overlaps, for Tim

- `AppMenuDrawer.tsx` also changes in PR #348 (focus handling and external link text, different hunks); merge #348 first and this one after, or expect a small manual merge in the imports.
- Step 5 (moving the registry into a workspace package for the marketing site) stays with Tim, as does whether `/rwc-2027` is the route base the rugby pages will use.
