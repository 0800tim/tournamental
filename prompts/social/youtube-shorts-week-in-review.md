# YouTube Shorts — weekly week-in-review

> Surface: YouTube Shorts. Event: weekly cron (Monday 9am PT).

## Visual

- **Compilation**: top 6 goals of the week, 8 seconds each, plus a 12-second
  intro "this week in {{tournament.name}}" slate. Total ≤ 60s for Shorts gating.
- **Intro slate**: branded `tournament-recap` story-format card from
  `@vtorn/social-cards` with `tournamentName="This week — {{tournament.name}}"`.

## Title (≤ 100 chars)

```
This week's top 6 — {{tournament.name}} • Week {{tournament.week_n}}
```

## Description

```
The 6 best goals from {{tournament.name}} this past week.

Visualisation: Tournamental 3D replay. Predict every match: {{cta.url}}

#Shorts {{tournament.hashtag}} #goalsoftheweek #weekrecap
```

## Tags

```
{{tournament.hashtag}}, weekly, recap, top goals, tournamental, predictions
```

## Optimal post time

Monday 9am PT. (The clip-week-recap on TikTok runs Sunday 7pm PT; the YouTube
post is staggered 14 hours later to capture the Monday-morning commute scroll.)

## CTA

`{{cta.url}}` — `https://tournamental.com/r/brand?utm_source=youtube&utm_campaign=week-recap&utm_content={{campaign.id}}`.

## Compliance

- Same content-disclosure pattern as goal-celebration.
- Per YouTube guidance, the description must include the source attribution
  (StatsBomb data, per `docs/11`). Auto-injected by the publisher.
