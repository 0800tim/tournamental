# YouTube Shorts — tournament recap

> Surface: YouTube Shorts. Event: tournament end (auto-DM only; users opt in
> to the auto-post-to-channel flow with their YouTube creds).

## Visual

- **Card-only Short**: 60-second motion render of the user's
  `tournament-recap` story-format card with stat counters animating up
  (0 → final value over 8s for each stat) plus a compilation montage of
  the user's correct-prediction goal clips behind it.
- **End-screen**: brand outro 5s.

## Title (≤ 100 chars)

```
{{user.handle}}'s {{tournament.name}} recap • {{stats.points_earned}} pts • #{{stats.rank}}
```

## Description

```
Final {{tournament.name}} stats for @{{user.handle}}:
- {{stats.points_earned}} points
- {{stats.accuracy_pct}}% accuracy
- #{{stats.rank}} of {{stats.total_entrants}}

Visualisation: Tournamental 3D replay. Run your own: {{cta.url}}

#Shorts {{tournament.hashtag}} #recap
```

## Tags

```
{{tournament.hashtag}}, recap, stats, tournamental, predictions
```

## Optimal post time

24 hours after tournament end.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=youtube&utm_campaign=tournament-recap&utm_content={{campaign.id}}`.
