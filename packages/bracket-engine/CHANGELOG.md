# Changelog

All notable changes to `@tournamental/bracket-engine` are documented
here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, breaking changes signal with a minor bump (0.x.0 -> 0.(x+1).0).

## [Unreleased]

### Added

- Pool table rules as data: `Tournament.sport` (`football` default,
  `rugby_union`, `rugby_league`) and `Tournament.standings_rules`
  (`PoolPointsRule` plus an ordered `TiebreakCriterion` chain). Presets
  `FOOTBALL_STANDINGS_RULES` and `RUGBY_UNION_STANDINGS_RULES`;
  `standingsRulesFor(tournament)` picks one.
- Rugby union pool arithmetic: 4-2-0, a bonus point for four or more
  tries and one for losing by seven or fewer, and the World Rugby
  tiebreak chain (head-to-head winner, points difference, tries
  difference, points for, tries for, world ranking, then the user's
  pick). Needs `MatchPrediction.homeTries` / `awayTries` and
  `Team.world_rank` (falls back to `fifa_rank`), all optional.
- `GroupStanding` gains `triesFor`, `triesAgainst`, `tryDiff` and
  `bonusPoints` (all 0 for football).
- `compareStandingsAcrossGroups(rules, teams?)`: a comparator for
  ranking the best third-placed teams under the tournament's rules.

### Changed

- The standings sort is a generic criterion chain. Football keeps
  FIFA's nested evaluation (points, goal difference, goals for,
  head-to-head mini-table, then the user's pick, with no
  re-application). Rugby union sets `restart_after_highest`: the chain
  finds the highest ranked of the level teams, places it, and repeats
  from the first criterion for the rest, as World Rugby's pool rules
  say. The 93 existing football tests pass as they were, plus one that
  pins the no-restart behaviour.
- The losing bonus is paid only when the scores agree with the outcome.
- The worktree's `node_modules` symlink that the previous push had
  committed is removed; `.gitignore` now ignores `node_modules` as a
  file or a directory. Football output is unchanged (points, goal
  difference, goals for, head-to-head mini-table, user pick); the 93
  existing tests pass as they were.

## [0.1.0] - 2026-05-13

- Initial public release on npm under the `@tournamental` scope.
- Cascade resolver, score model, group standings, VStamp envelope.
- Vendored FIFA WC 2026 fixtures via `./fixtures-2026`.
- VStamp ships as a subpath import only so client bundles stay small.
