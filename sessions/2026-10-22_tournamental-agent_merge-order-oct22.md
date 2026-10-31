# 2026-10-22 — tournamental-agent — merge order for #366 to #380

**Status**: done

**PR**: docs/merge-order-2026-10-22 (draft)

## Goal

Extend `docs/reviews/2026-10-draft-pr-merge-order.md` with a dated section
for the fifteen draft PRs opened since 20 October (#366 to #380), so Tim
has one page for the order, the restart points and the checks.

## Reading

- The two earlier sections of the paper (17 and 20 October) for format.
- The integration branch `integration/2026-10-22-burn-chain`: all fifteen
  merged for real, two conflicts resolved, full suites green.
- `systemctl --user cat tournamental-web` and `tournamental-game` (read
  only) for what each unit runs: `next start` from a build that bundles
  the engine from source; `tsx src/server.ts` against workspace source.

## Decisions

- **Real merges, not merge-tree**: the integration worktree already
  existed from the chain check, so the overlap table is what git
  actually did, and the test counts are from the combined tree.
- **Restart column per PR**: an engine change needs a web build and both
  restarts; a game-only change needs the game restart alone; docs, CI,
  tests and the session archive need nothing.
- **Digest renumbered from 31** so the three sections read as one list.
  Item 5 of the pass-nine hivemind questions is partly answered by #371
  (`data/rwc-2027/teams.json` exists now); the paper says what is left.

## Outcome

One section appended, no other file changed. Docs only, nothing to run.

## Refs

- docs/reviews/2026-10-draft-pr-merge-order.md
- hivemind logs/2026/10-tournamental.md, passes nine and thirteen
