# prompts/social

Surface × event-kind post templates consumed by `apps/clip-publisher` and the Telegram /
Discord syndication bots. Each file is a self-contained brief: visual, caption,
hashtags, optimal post time, and CTA.

## Surfaces

- `tiktok-*.md` — TikTok video posts (driven by the auto-clip pipeline, doc 14).
- `instagram-*.md` — Instagram Reels / Stories.
- `x-*.md` — X (Twitter) tweets and threads.
- `youtube-shorts-*.md` — YouTube Shorts.

## Event kinds

The six events that produce a card / clip per `docs/24` and `docs/14`:

- `goal-celebration` — auto-fired by `event.goal`.
- `bracket-locked` — fired when a user locks their bracket pre-tournament.
- `match-result` — fired at full-time.
- `leaderboard-climb` — fired on threshold crossings (top-100, top-50, top-10, #1).
- `badge-earned` — fired by the badge award engine.
- `tournament-recap` — fired at end-of-tournament for active users.

Plus surface-specific add-ons:

- `x-thread-tournament-recap.md` — full thread script for the X recap.
- `youtube-shorts-week-in-review.md` — weekly compilation post.
- `instagram-story-bracket-poll.md` — story-format poll variant.
- `tiktok-clip-week-recap.md` — weekly recap reel.

## Variable contract

All templates reference variables in `{{handlebars}}`. A canonical variable set is
documented in `_variables.md` so no template invents a variable that the publisher
doesn't bind. Adding a variable is a doc-update PR.

## Hashtag philosophy

Hashtag sets per template are *curated*. The auto-caption layer never invents tags —
the canonical lists live in `data/hashtags/<tournament_id>.json` (per doc 14). The
template hashtag block is the *default* set the publisher merges with the tournament
list; per-locale variants live in `docs/27-social-distribution-strategy.md`.
