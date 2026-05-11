# Instagram Reel — goal celebration

> Surface: Instagram Reels. Event: `event.goal`.
> Posted via the Instagram Graph API (per `docs/14` § Native APIs).

## Visual

- **Video**: same 1080×1920 vertical clip used for TikTok, re-encoded at the IG
  recommended bitrate (5Mbps H.264, ≤ 90s).
- **Cover image**: 1080×1920 `goal-clip` story-format card from `@tournamental/social-cards`,
  posted as the explicit Reel cover (set via the IG Graph API field `cover_url`).

## Caption

```
{{event.scorer}} just put {{match.team_winning}} ahead {{match.score_team0}}-{{match.score_team1}}. {{event.minute}}'

Watch every match in 3D. Predict every goal. Climb a global board.

{{#if user.predicted_this}}
@{{user.handle}} called this exact moment {{event.minute}} minutes ago.
{{/if}}

🔗 in bio.
```

## Hashtags

The first 5 hashtags go in the *caption* (highest weight); the remaining 25 go in
the first comment (per Meta's 2026 algorithm guidance):

In caption:
```
{{tournament.hashtag}} #{{event.scorer_lastname}} #{{match.team_winning}} #goal #Tournamental
```

In first comment (auto-posted by publisher):
```
#football #soccer #predictions #fantasysports #worldcup #fifa #sports #brackets #leaderboard #fyp #reels #explore #viral #sportsfans #footballfans #soccerfans #goalcelebration #goals #scorers #fanart #sportsbetting #sportscontent #fan #fanclub #matchday
```

## Optimal post time

Within 5 minutes of clip availability — Instagram Graph API has a higher latency
tolerance than TikTok. Live-spike windows: the 30 minutes after a goal in the
tournament's home time zone.

## CTA

The Reel itself does not carry the URL. The bio link rotates to the relevant
campaign URL during the tournament:
`{{cta.url}}` — `https://tournamental.com/r/brand?utm_source=instagram&utm_campaign=goal-celebration&utm_content={{campaign.id}}`.

## Compliance

- IG Reels disallow third-party promo links in the caption — bio-link only.
- Branded-content disclosure: not required for organic brand posts, but if a
  partnered creator re-uses the asset, they must enable the IG paid-partnership
  label.
