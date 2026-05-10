# X — goal celebration (single tweet)

> Surface: X (Twitter). Event: `event.goal`.
> Posted via the X API v2 chunked media upload + tweet-create flow.

## Visual

- **Media**: 1080×1350 4:5 cut of the goal clip (X's native vertical aspect for
  in-feed video). Falls back to 16:9 if 4:5 isn't ready.
- **Cover image**: 1200×630 `goal-clip` OG card rendered by `@vtorn/social-cards`,
  uploaded as the video preview.

## Caption (≤ 280 chars including URL)

```
{{event.scorer}}. {{event.minute}}'.

{{match.team0_code}} {{match.score_team0}}-{{match.score_team1}} {{match.team1_code}}.

{{cta.short_url}}
```

Total budget: ~70 chars copy + 23 chars URL = under 100. Plenty of room for
hashtags but X's algorithm rewards low-tag posts; use 1.

## Hashtags

```
{{tournament.hashtag}}
```

(One only. Multi-tag X posts are deboosted.)

## Optimal post time

Within 2 minutes of clip availability. X is the lowest-latency surface; goal
posts here drive related-search and trending-topic surfacing.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=x&utm_campaign=goal-celebration&utm_content={{campaign.id}}`.
We use `cta.short_url` because X counts every URL as 23 chars regardless of
length, so the *display* matters but bytes don't.

## Compliance

- X allows sportsbook affiliate links *if* the account is geofenced and the
  jurisdictional disclosure is in profile. Per doc 27 § Compliance, brand-channel
  goal posts never carry an affiliate link directly — they link to tournamental.com,
  which routes per geo.
