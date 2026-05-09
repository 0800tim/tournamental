# Instagram Reel — badge earned

> Surface: Instagram Reels. Event: `badge_earned` (auto-share-DM only;
> brand-channel only for Mythic / Platinum tier badges).

## Visual

- **Card**: `badge-earned` story-format card from `@vtorn/social-cards`. The card
  ships the tier colour bar and the badge title prominently.
- **Length**: 6 seconds.
- **Motion (Mythic/Platinum)**: shimmer overlay rendered by clip-pipeline.

## Caption

```
{{badge.tier}} badge unlocked — {{badge.title}}.

{{badge.description}}

🔗 in bio to start your own.
```

## Hashtags

```
{{tournament.hashtag}} #achievement #predictions #VTourn #reels
```

## Optimal post time

Within 5 minutes of badge award.

## CTA

Bio link → `{{cta.url}}` (`https://vtourn.com/r/{{user.id}}?utm_source=instagram&utm_campaign=badge-earned&utm_content={{campaign.id}}`).

## Compliance

- Mythic / Platinum badges are NFTs (per `docs/24` § Badge tiers). Brand-channel
  posts referencing NFT awards must not promise resale value or discuss royalties.
