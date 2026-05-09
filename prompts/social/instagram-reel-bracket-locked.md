# Instagram Reel — bracket locked

> Surface: Instagram Reels. Event: `bracket_locked`.
> User-share: pushed to user via DM with one-tap repost. Brand channel: not used.

## Visual

- **Card**: `bracket-prediction` story-format card.
- **Optional motion**: 3-frame zoom and a "🔒 LOCKED" stamp animation appended
  by the clip-pipeline when re-rendering for IG.
- **Length**: 8 seconds.

## Caption

```
My {{tournament.name}} bracket is locked in 🔒

{{stats.predictions_locked}} picks. Final answer.

Run yours: link in bio.
```

## Hashtags

```
{{tournament.hashtag}} #bracketchallenge #predictions #VTourn #reels
```

(plus the standard secondary set in first comment — see `instagram-reel-goal-celebration.md`.)

## Optimal post time

48 hours before tournament kickoff in the user's local time zone (8pm).

## CTA

Bio link → `{{cta.url}}` (`https://vtourn.com/r/{{user.id}}?utm_source=instagram&utm_campaign=bracket-locked&utm_content={{campaign.id}}`).

## Compliance

- Same rules as goal-celebration. No real-money pool references.
