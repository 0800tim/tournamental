# TikTok — leaderboard climb

> Surface: TikTok. Event: `leaderboard_climbed` crossing top-100 / top-50 / top-10 / #1.
> Auto-DM'd to the user; auto-posted only on opt-in.

## Visual

- **Card**: `leaderboard-rank` story-format card from `@tournamental/social-cards` showing the
  rank, the scope, and the weekly move arrow. URL: `{{card.story_url}}`.
- **Motion**: 3-frame Ken Burns zoom on the card from 110% → 100% over 4s, then a
  freeze frame for 5s with a caption overlay.
- **Music**: trending hype track from the TikTok Commercial Music Library.

## Caption

```
{{stats.rank}} on the {{tournament.name}} {{stats.scope_label}} leaderboard.

{{#if stats.weekly_move > 0}}
Up {{stats.weekly_move}} this week. Keep coming. ⬆️
{{else}}
Holding the line. Catch me. 🔒
{{/if}}

{{cta.short_url}}
```

## Hashtags

```
{{tournament.hashtag}} #leaderboard #Tournamental #predictions #fyp
```

## Optimal post time

Within 30 minutes of the threshold-cross event. The leaderboard ticker is real-time;
delaying past 30 min flattens engagement.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=tiktok&utm_campaign=leaderboard-climb&utm_content={{campaign.id}}`.

## Compliance

- The post may not imply that climbing the leaderboard pays cash (it does not).
- Bonus tokens may be referenced but only as platform credit, never as withdrawable
  currency. See `docs/24` § Tokens.
