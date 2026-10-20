# 2026-10-20, game and admin test suites to green

**Source**: the standing burn task; both suites had pre-existing failures found while working PRs #352 and #360.
**Branch**: `fix/game-match-result-tests` (worktree, from main). Test files only; no runtime code changed.

## apps/game, 12 failures to 0 (257 pass)

- `tests/match-result.test.ts`, `bracket-by-guid.test.ts`, `leaderboard.test.ts`: the test server ran on the real clock, and bracket submit strips picks whose match has kicked off on the server clock, so every seeded bracket lost its picks and nothing was left to score. Each now pins `nowMs` to 1 June 2026, the pattern `kickoff-lockout.test.ts` already used.
- `tests/routes-swarm.test.ts`: since 1c44074f (8 June) a swarm commit requires a signed-in user, verified as an auth-sms HS256 session JWT against `AUTH_JWT_SECRET`; the route, unlike its siblings, never enables the x-user-id dev fallback. The test now sets a test secret and mints a token with `node:crypto`.

## apps/admin, 5 failures to 0 (106 pass)

- `__tests__/pages/login.test.tsx`: `LoginPage` is an async server component; the test rendered the promise. It now awaits the page first.
- `__tests__/pages/customer360Tabs.test.tsx`: the confirm button reads "Delete user", the test looked for "Delete data".

All runs under `systemd-run --user --scope -p MemoryMax=3G`, one suite at a time.

## Needs Tim

Merge; nothing to restart. With PR #344 (web) and PR #351 (bot-sdk typecheck) this makes the workspace `pnpm test` and `pnpm typecheck` green for the first time since June, once the CI Node job is on a branch that has all three.
