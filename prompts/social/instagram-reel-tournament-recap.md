# Instagram Reel — tournament recap

> Surface: Instagram Reels. Event: tournament end.
> User-share via auto-DM. Brand-channel: yes (with anonymised top-finisher card).

## Visual

- **Card**: `tournament-recap` story-format card from `@tournamental/social-cards`.
- **Length**: 30 seconds — 8s stat-counter intro → 18s top-3 user goal-clip
  highlights → 4s outro.
- **Cover**: the recap card itself.

## Caption

```
{{tournament.name}} — wrapped.

@{{user.handle}}: {{stats.points_earned}} pts • {{stats.accuracy_pct}}% accuracy • #{{stats.rank}} of {{stats.total_entrants}}.

The next one's already open. 🔗 in bio.
```

## Hashtags

In caption:
```
{{tournament.hashtag}} #recap #predictions #Tournamental
```

In first comment:
```
#football #soccer #worldcup #fantasysports #brackets #leaderboard #fyp #reels #explore #viral #sports #fan #year-in-review #sportsfans #footballfans #soccerfans #recap #tournament #sportscontent #fanart
```

## Optimal post time

24 hours after tournament end, 7pm in the user's local time zone.

## CTA

Bio link → `{{cta.url}}` (`https://tournamental.com/r/{{user.id}}?utm_source=instagram&utm_campaign=tournament-recap&utm_content={{campaign.id}}`).

## Compliance

- Brand-channel posts using user-recap cards must use opt-in users only or
  anonymise the handle to a generic "Top finisher".
