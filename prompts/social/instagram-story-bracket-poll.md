# Instagram Story — bracket poll

> Surface: Instagram Stories. Event: pre-match (1h before kickoff) for any
> match where the *country* leaderboard has > 1000 entrants.
> Brand-channel only.

## Visual

- **Background**: `match-result` story-format card from `@vtorn/social-cards` rendered
  pre-kick (no scores filled). The `predictedScoreTeam0` / `predictedScoreTeam1` fields
  are blank; the headline is overridden to "Lock your call." via the optional
  `inviteHeadline` parameter.
- **IG sticker**: vertical poll asking `Who wins? {{match.team0_code}} vs {{match.team1_code}}`.

## Caption

```
{{match.label}} kicks off in 1h.

Tap your call below 👇 or lock it for points →
```

## Hashtags

Stories don't surface hashtags reliably; we ship one for indexing only:
```
{{tournament.hashtag}}
```

## Optimal post time

Exactly 60 minutes before kickoff. The publisher reads the spec stream's
match metadata and schedules.

## CTA

Sticker `Link` → `{{cta.url}}` (`https://tournamental.com/r/brand?utm_source=instagram&utm_campaign=bracket-poll&utm_content={{campaign.id}}`).

## Compliance

- IG Stories polls are not betting markets. Caption must not reference odds or stakes.
- Sticker `Mention` must not @ a player without their explicit consent.
