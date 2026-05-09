# TikTok — week-in-review compilation

> Surface: TikTok. Event: weekly cron (Sunday 7pm in the tournament's primary
> time zone). Posted from the brand `@vtourn` channel, not user channels.

## Visual

- **Compilation**: the top 6 goal clips of the week from the auto-clip pipeline,
  ordered by engagement (views + saves + shares × weight). 60s total, 10s per clip.
- **Outro**: branded 4-second card with the week's top-leaderboard rank stat, built
  from `@vtorn/social-cards` `tournament-recap` card variant tuned to a "this week"
  scope. URL: `{{card.story_url}}`.

## Caption

```
This week's top 6 goals from the {{tournament.name}} 🎯

If you're not predicting yet, you're losing free points →
{{cta.short_url}}
```

## Hashtags

```
{{tournament.hashtag}} #goals #compilation #weekrecap #VTourn #predictions #fyp
```

## Optimal post time

Sunday 7pm primary tournament time zone. For the World Cup 2026 in NA, that's
7pm PT / 10pm ET. The publisher computes the local-time Sunday window per
tournament metadata.

## CTA

`{{cta.url}}` — `https://vtourn.com/r/brand?utm_source=tiktok&utm_campaign=week-recap&utm_content={{campaign.id}}`.

## Compliance

- All clips reused must have engagement data older than 24h (so we can verify they
  haven't been flagged or removed by the user).
- Brand-channel posts must include the `Visualisation: VTourn 3D replay`
  description string.
