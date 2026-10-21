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

## Review (2026-10-22)

Independent review of the PR. Fixed: `kickoffCatalogue` cached an
entry for every id it was asked about, and the id comes from a public
path parameter, so any caller could grow the map; unknown ids now
return a shared empty catalogue without caching. A touched comment
lost its dash. Also done here: `MatchOutcome` and the result route now
carry `homeTries`/`awayTries` (the schema already accepted them, the
stored JSON dropped them), with a test; the web results path on #376
reads them. Noted, not changed: the share-page summariser's
`knockout_path` always starts at `r32`, so an RWC bracket carries a
permanent `r32: tbd` row until the share UI is sized from
`tournament.knockouts` (added to IDEAS.md).
