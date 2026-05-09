# TikTok — bracket locked

> Surface: TikTok. Event: `bracket_locked` (user-fired).
> Posted to the user's own TikTok via the auto-share-DM flow only — never
> auto-posted to a brand channel without explicit opt-in.

## Visual

- **Card**: `bracket-prediction` story-format card from `@vtorn/social-cards` rendered
  with the user's full lock. URL: `{{card.story_url}}`.
- **Format**: 5-second still card → 10-second talking-head reaction → 5-second outro.
  The reaction is the user's optional selfie video uploaded with the lock; if absent,
  the post is card-only.
- **Cover frame**: the bracket card itself.

## Caption

```
My {{tournament.name}} bracket is in. {{stats.predictions_locked}} picks, locked. 🔒

If you think I'm wrong, run yours and beat me 👇
{{cta.short_url}}
```

## Hashtags

```
{{tournament.hashtag}} #BracketChallenge #VTourn #predictions #fyp
```

## Optimal post time

48 hours before the tournament's first match — catches the pre-tournament search
spike. The publisher schedules per the user's local time zone (8pm).

## CTA

`{{cta.url}}` — `https://vtourn.com/r/{{user.id}}?utm_source=tiktok&utm_campaign=bracket-locked&utm_content={{campaign.id}}`.

## Compliance

- No real-money pool references in the caption (the share targets the free-to-play
  syndicates surface; real-money pools are user-organised and off-platform).
