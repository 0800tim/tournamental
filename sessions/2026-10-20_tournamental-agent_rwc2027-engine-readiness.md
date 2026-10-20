# 2026-10-20, RWC 2027 engine readiness note

**Task**: burn round 7, `docs/design/rwc2027-engine-readiness.md`, design only.
**Branch**: `docs/rwc2027-engine-readiness` (worktree, docs only).

## What it says

What carries over (stages, slot sources, knockout no-draw rule, string team ids with trigrams already in use for England and Scotland, the sport-agnostic settlement bridge, the fixture JSON shape) and eight sized gaps: 4-2-0 with try and losing bonus points (M), rugby tiebreakers (M), the round of 16 from six pools (S to M, pending the regulations), knockout methods and `tp` in the settlement enum (S), team ids, rankings and flags (S), a data package and the parameterised bracket builder in place of `apps/wc2026-data` and `loadFixtures2026()` with its 35 web call sites (L), a rugby live provider (M), and the scoring model (S, product). An order of work and the decisions that gate it. Growth and prize material kept out.

## Needs Tim

The R16 placement rule from the regulations, the rugby scoring model, the live provider, and whether to commit the untracked rugby-league fixture drafts.
