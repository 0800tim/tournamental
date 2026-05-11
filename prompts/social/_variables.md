# Canonical template variables

All `{{handlebars}}` values referenced from `prompts/social/*.md` resolve to one of
the variables below. The clip-publisher binds these from the spec event payload +
the user record + the tournament metadata. Adding a new variable is a PR against
this file *and* the publisher's bind layer.

## User

- `{{user.handle}}` — display handle, no `@` prefix (the template adds `@` where it wants one).
- `{{user.id}}` — referral target id.
- `{{user.locale}}` — BCP-47 tag.
- `{{user.country}}` — ISO 3166-1 alpha-2 (e.g. `NZ`).

## Match / event

- `{{match.label}}` — `"ARG vs FRA — Final"`.
- `{{match.team0_code}}` / `{{match.team1_code}}` — three-letter codes.
- `{{match.score_team0}}` / `{{match.score_team1}}` — final or current score.
- `{{event.minute}}` — `78`.
- `{{event.scorer}}` — `"Lionel Messi"` (goal events only).

## Tournament

- `{{tournament.name}}` — `"World Cup 2026"`.
- `{{tournament.id}}` — `"wc26"`.
- `{{tournament.hashtag}}` — canonical primary tag, e.g. `#WorldCup2026`.

## User performance

- `{{stats.points_earned}}` — points from this match or tournament.
- `{{stats.rank}}` — leaderboard rank.
- `{{stats.total_entrants}}` — denominator.
- `{{stats.weekly_move}}` — signed integer.
- `{{stats.accuracy_pct}}` — 0-100.

## Badge

- `{{badge.title}}` — `"Messi Moment"`.
- `{{badge.tier}}` — `bronze | silver | gold | platinum | mythic`.
- `{{badge.description}}` — short copy, no HTML.

## Distribution

- `{{cta.url}}` — full referral URL with UTM params (per `apps/clip-publisher`'s referral builder).
- `{{cta.short_url}}` — shortened version for X 280-char templates.
- `{{card.og_url}}` — public URL of the OG card produced by `@tournamental/social-cards`.
- `{{card.story_url}}` — public URL of the story-format card.

## Campaign tracking

- `{{campaign.id}}` — UUIDv7 stamped on the post; engagement events join back via this id.
- `{{campaign.name}}` — human label, e.g. `wc26-goal-celebration-2026-06-24`.
