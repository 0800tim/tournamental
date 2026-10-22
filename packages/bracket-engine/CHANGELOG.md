# Changelog

All notable changes to `@tournamental/bracket-engine` are documented
here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, breaking changes signal with a minor bump (0.x.0 -> 0.(x+1).0).

## [Unreleased]

### Added

- `bracketToCascadeInput(tournament, bracket, userId, nowIso?)` in
  `bridge`: the per-match `Bracket` to cascade `BracketPrediction`
  conversion that the web app and the game service each carried a copy
  of. One helper, one set of rules (orders only for complete groups,
  best thirds from the user's picks, knockouts left for the cascade).

## [0.1.0] - 2026-05-13

- Initial public release on npm under the `@tournamental` scope.
- Cascade resolver, score model, group standings, VStamp envelope.
- Vendored FIFA WC 2026 fixtures via `./fixtures-2026`.
- VStamp ships as a subpath import only so client bundles stay small.
