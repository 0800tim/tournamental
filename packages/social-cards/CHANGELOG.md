# Changelog

All notable changes to `@tournamental/social-cards` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, breaking changes signal with a minor bump (0.x.0 -> 0.(x+1).0).

## [Unreleased]

## [0.1.0] - 2026-05-13

- Initial public release on npm under the `@tournamental` scope.
- Satori-based OG, podium, badge, leaderboard, recap, referral and goal
  clip cards.
- Canvas-rendered bracket share card and molecule capture card.
- Bracket-reveal video composer.
- Native runtime deps (`@napi-rs/canvas`, `@resvg/resvg-js`, `satori`,
  `qrcode`) stay as normal `dependencies` so consumers do not need to
  install them separately.
