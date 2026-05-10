# X — match result

> Surface: X. Event: `match_view_completed` (or `match_end` from spec).

## Visual

- **Media**: 1200×630 `match-result` OG card. The card's headline already varies
  with whether the user predicted exactly / called the side / banked points.

## Caption (≤ 280 chars)

```
{{match.team0_code}} {{match.score_team0}}-{{match.score_team1}} {{match.team1_code}}. Full-time.

{{#if user.predicted_exact}}
Exact score. +{{stats.points_earned}} points.
{{else if user.predicted_winner}}
Result called. +{{stats.points_earned}} points.
{{else}}
On to the next.
{{/if}}

{{cta.short_url}}
```

## Hashtags

```
{{tournament.hashtag}}
```

## Optimal post time

Within 5 minutes of full-time — the post-match X spike runs ~30 minutes.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=x&utm_campaign=match-result&utm_content={{campaign.id}}`.
