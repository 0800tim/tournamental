# 2026-10-17, design note: registry-driven tournament chrome

**Task**: burn round 6, `docs/design/registry-driven-tournament-chrome.md`, describe only.
**Branch**: `docs/registry-driven-chrome` (worktree, docs only).

## What it covers

Every hand edit the host-modes runbook (PR #338) lists as not covered by the registry flip, plus three more found while reading: the AppBar sub-label, the AppMenuDrawer labels and archive links, the layout title, the FWC2026 defaults in the four OG routes, the `/world-cup-2026` hrefs in the nav lists, the two middleware constants, and the marketing Hero, Header, Footer and archive index. For each, how it should read from the registry, which new entry fields that needs (code, routeBase, artDir, aliasHosts, marketingArchivePath, openingCity, openingVenue), and how the marketing site can share the registry (move it to a workspace package, recommended, or fetch it at build).

## Outcome

Draft PR opened. Needs Tim: agree the package move and the field list; then the five small PRs in the order the note gives. Nothing merged.
