# Changelog

All notable changes to `@tournamental/spec` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 the spec surface may evolve; breaking changes bump the minor
version (0.x.0 -> 0.(x+1).0).

## [Unreleased]

## [0.1.0] - 2026-05-13

- Initial public release on npm under the `@tournamental` scope.
- Carries the spec at `SPEC_VERSION = "0.1.1"` (the previous
  `@vtorn/spec@0.1.1` shipped to internal workspace consumers only).
- Three message kinds: `MatchInit`, `StateFrame`, `EventMessage`.
- Coordinate, time, and ID conventions documented inline.
