# 2026-10-21 · The game service knows every vendored tournament

status: done
docs: docs/design/rwc2027-engine-readiness.md (gap 6, second half, game side)
stacked on: feat/rwc-2027-fixtures (PR #369)

Three places in `apps/game` were keyed to the literal `fifa-wc-2026`:
the kickoff registry (lockout at kickoff), the share page's fixture
set (which always used 2026, even in its "pick the right tournament"
branch), and the leaderboard's kickoff catalogue. They now resolve by
id through `loadFixtures()` for any tournament the engine vendors
(`isVendoredTournament` in `kickoffs.ts`), cached per id. Unknown ids
behave as before: null kickoff lookup (every prediction accepted), the
2026 set on the share page so the legacy regex summariser still runs,
an empty catalogue. Four tests in `tests/vendored-tournaments.test.ts`;
the kickoff lockout, share page and leaderboard suites still pass
(33 cases); game typecheck clean. Nothing merged or deployed.
