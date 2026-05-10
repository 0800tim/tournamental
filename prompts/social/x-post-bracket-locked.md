# X — bracket locked

> Surface: X. Event: `bracket_locked`. User-share via auto-DM.

## Visual

- **Media**: 1200×630 `bracket-prediction` OG card from `@vtorn/social-cards`.
- **Format**: single image post.

## Caption (≤ 280 chars)

```
My {{tournament.name}} bracket is in. {{stats.predictions_locked}} picks. Locked.

Run yours and beat me 👇
{{cta.short_url}}
```

## Hashtags

```
{{tournament.hashtag}}
```

## Optimal post time

48 hours before tournament kickoff. The publisher computes this from
`{{tournament.first_match_kickoff_iso}}` minus 48h, scheduled at the user's
local 8pm if it falls within ±6h.

## CTA

`{{cta.url}}` — `https://tournamental.com/r/{{user.id}}?utm_source=x&utm_campaign=bracket-locked&utm_content={{campaign.id}}`.
