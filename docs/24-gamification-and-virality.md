# 24 — Gamification, badges, and virality

> What turns a prediction app into something users *want* to share. Badges, streaks, leaderboards, share mechanics, and the auto-clip pipeline that drops branded short videos into socials throughout every tournament.

## The core loop

```
       PREDICT  ──►  WATCH  ──►  WIN/LOSE  ──►  SHARE  ──►  RECRUIT
          ▲                                                     │
          └─────────────────────────────────────────────────────┘
```

Every loop iteration earns the user something concrete: points, tokens, a badge, a leaderboard climb, a clip. Every share has a referral hook. The bot persona system (doc 23) closes the loop for users who fall out of it.

## What we're solving for

1. **Day-1 engagement**: the new user makes a prediction in their first session. Without a prediction, they're just a viewer; with one, they have skin in the game.
2. **Day-7 retention**: the new user returns at least once per match-day in their first week. Streaks + push notifications carry this.
3. **Sharing rate**: at least 8% of active users share at least one piece of content per week. Shareable artefacts (clips, badge cards, prediction receipts) are the lever.
4. **Referral conversion**: shared content has a 3%+ click-through into a signup. Tracked via UTM + first-party referral codes.

These are aspirational; they get measured every week (per `docs/23`'s admin dashboard) and the gamification mix is tuned accordingly.

## Badges

Badges are first-class objects with a definition, an award rule, an artefact, and a share card.

### Badge definition format

`packages/badges/definitions/<slug>.yaml` (one file per badge):

```yaml
slug: messi-moment
title: Messi Moment
tier: bronze | silver | gold | platinum | mythic
description_short: Predicted a Messi goal in any FIFA tournament match.
description_long: |
  Submit a prediction that "Messi scores" before the match starts, then
  see Messi find the net. The badge auto-awards on settlement.
artefact: badges/messi-moment.png    # 512x512 PNG, public-domain art only
share_card_template: badge-card-default
award_rule:
  kind: prediction-outcome
  filter:
    market: player_to_score
    selection: { player_id: messi }
    outcome: won
  cooldown: per_user
unlock_reward:
  tokens: 25
  iq_boost: +0.1
```

### Badge tiers (visual ladder)

| Tier      | Colour        | What earns it                                                    |
| --------- | ------------- | ---------------------------------------------------------------- |
| Bronze    | warm bronze   | Common achievements (first prediction, first share, first watch). |
| Silver    | brushed steel | Uncommon (5-game streak, top-100 weekly leaderboard).            |
| Gold      | gold leaf     | Skill (top-10 weekly, perfect tournament group, 80% IQ over 50 predictions). |
| Platinum  | platinum-grey | Rare (top-3 season, predicted a 50-1 outcome correctly).         |
| Mythic    | iridescent    | Once-per-tournament drops (tournament winner, first platinum holder, viral-clip creator). |

Mythic and Platinum badges are **NFTs on the same chain as VStamps** (per doc 17). Bronze/Silver/Gold are off-chain receipts (a row in `badges_awarded` plus a signed JSON token the user can display anywhere).

### Award engine

Pure consumer of the events stream (per doc 23). Reads a settled prediction or relevant aggregate event, evaluates each active badge's `award_rule`, awards if matched, fires `badge_earned` event back into the stream. The engine is `apps/award-engine/`.

Determinism: the same input event sequence yields the same badge awards every time. Replayability is a property — we can re-derive every user's badge ledger from the events table.

### Surfaces

- **Match HUD**: when a prediction settles, a small modal celebrates the badge (audio cue + share-now CTA).
- **Profile page**: a wall of earned badges; locked badges shown with criteria.
- **Share card**: the badge artefact + tier + the user's handle + a referral URL, rendered server-side at `vtorn-api.aiva.nz/share/badge/<id>.png` (cached forever; immutable).
- **Telegram bot**: pushes the share card with copy tuned to the user's engagement band.

## Streaks

| Streak name      | Increment when...                                  | Resets when... | Reward        |
| ---------------- | -------------------------------------------------- | -------------- | ------------- |
| Daily prediction | At least 1 prediction submitted on a calendar day  | Day with no prediction | +1 token / day, 1.5x multiplier at 7+ days |
| Match-day        | At least 1 prediction in every match-day in the tournament | Match-day skipped | tournament-locked badge "Match-day Devotee" |
| Hot hand         | Consecutive prediction wins                        | A loss         | "Hot hand" badge cascade (3, 5, 10, 20, 50) |
| Sharer's high    | Share something every day                          | Day with no share | "Word of mouth" badge tier ladder |

Streaks are durable: every increment is logged as `streak_continued`, every reset as `streak_broken`. Power-users self-monitor via the profile page.

## Leaderboards

Three scopes, three timeframes each.

| Scope     | All-time | Season | Weekly |
| --------- | -------- | ------ | ------ |
| Global    | ✓        | ✓      | ✓      |
| Country   | ✓        | ✓      | ✓      |
| Tournament| ✓        | n/a    | ✓      |

Each leaderboard top-100 is a Redis sorted set updated on every settlement. Top-10 is rendered fresh per request; 11–100 is cached 30s; 101+ is paginated and served straight from Postgres with a 5-minute SWR.

Leaderboard moves trigger events:
- `leaderboard_climbed` (n positions, into top X) — only fires for moves that cross thresholds (top-100 entry, top-50 entry, top-10 entry, #1).
- These events are *high signal* for share prompts.

## Tokens (off-chain)

Bonus tokens are an off-chain points currency users earn from streaks, referrals, badge unlocks, and prediction-IQ achievements. They convert at platform discretion to:

- Higher stake limits in social tournaments.
- Free entries to gated tournaments.
- Cosmetic unlocks (avatar accents, name flair).
- Quarterly raffles for real prizes (per doc 19's contributor-revenue model — overlapping mechanics).

**Tokens are never withdrawable as cash.** This is a play-to-engage system, not a wallet. For real prize draws, see VTornOracle (doc 21) and the on-chain pools.

## Sharing

Every shareable surface produces a tracked URL: `https://vtorn.com/<surface>/<id>?r=<user_id>&utm_source=<channel>&utm_campaign=<surface>`.

Surfaces:

- **Prediction card**: "I predicted Argentina 4-2 France in the WC Final shootout. Did you?" + auto-generated PNG with the user's handle and the prediction.
- **Badge card**: the badge artefact + share copy.
- **Leaderboard card**: "I'm #N globally on VTorn. Catch me." + leaderboard snapshot.
- **Match-clip card**: a 6–10s video of a key moment, branded with the user's handle if they predicted it correctly.
- **Tournament-recap card**: post-tournament summary of wins / losses / points / rank.

Channels (in priority order): WhatsApp, Telegram, X (Twitter), Instagram (DM and Stories), TikTok, native mobile share sheet, copy-link.

Each share fires `share_clicked`. Each redemption fires `referral_redeemed`. The acquiring user is tagged in their first session with `referrer_user_id`, which carries forward in every event for them.

## Auto-clip pipeline

Every goal, save, foul-card, and shootout attempt in a streamed match becomes a 6–10s clip in three formats (9:16 for TikTok/IG/Shorts, 1:1 for X, 16:9 for YouTube). Clips are produced by the renderer's offscreen recorder fed off the same spec stream the live viewers watch — no separate broadcast is needed.

Pipeline (per `docs/14-clip-generation-and-social.md`, this section refines the gamification overlay):

1. `apps/clip-recorder/` (background worker, headless Chromium) listens for spec event triggers.
2. Pre-roll: 2s before the event timestamp from the recorded spec stream. Post-roll: 4–6s. Recorder seeks the renderer to that range and dumps frames.
3. ffmpeg encodes to H.264 with a branded outro (1s VTorn end-card with the auto-injected referral URL).
4. Caption auto-built from the event payload (e.g. *"Messi just put Argentina ahead in the World Cup Final 🇦🇷"*).
5. `apps/clip-publisher/` cross-posts to enabled platforms via their official APIs (TikTok Content Posting API, Instagram Graph API for Reels/Stories, X API v2, YouTube Data API).
6. Each post records its post-id; engagement (views/likes/shares) flows back into our event stream as `social_post_engaged`.

**Tournament-wide policy**: during a live tournament, expect 50–200 clips per match-day. Schedule must respect platform rate limits; the publisher implements per-platform exponential backoff.

**Personalised clips** are the multiplier: when a user predicted the goal correctly, the clip overlays their handle and prediction in the corner ("Pat from Auckland called this 17 minutes ago"). They get a private DM with the share-ready clip. *That's* the viral hook.

## Bot persona policies (gamification slice)

Per `docs/23-analytics-and-marketing-insights.md`, bots act on engagement bands. Gamification adds:

| Band               | Trigger                                      | Outreach                                                                  |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------- |
| Lurker (score 0–20)| Last seen 24h, no prediction in 7d            | Telegram nudge with the next match's odds + 1-tap prediction CTA.         |
| Casual (20–50)     | Streak about to break                         | Push: "Your daily-prediction streak is at 6. Lock one in by midnight."    |
| Engaged (50–80)    | Earned a Silver+ badge                        | Auto-DM the share card with copy variants A/B tested.                     |
| Super-engaged (80+)| Top-10 weekly OR 5+ referrals in a week       | Personal email from "Tim" with early-access token to next feature drop.   |

A/B variants are tracked; the winning copy after 1000 sends becomes the new default.

## Cross-checks with other docs

- Per `docs/17-vstamp-and-prediction-iq.md`: Prediction IQ feeds the engagement score directly and is the basis for skill-based badges.
- Per `docs/18-monetization.md`: bonus tokens never substitute for the affiliate / on-chain pool revenue lanes; they're a retention surface, not a revenue surface.
- Per `docs/20-identity-humanness-bots.md`: a Humanness Score gate prevents bot accounts from gaming streaks/leaderboards; gamification rewards are clamped if the Humanness Score is low.
- Per `docs/21-onchain-sweepstakes-oracle.md`: real-prize raffles are gated through VTornOracle; tokens above a threshold + a Humanness check are required to enter.

## What every gamification PR is reviewed against

- Did this PR add a new surface that *can be shared*? → Was a share card and tracked URL produced?
- Did this PR add a reward? → Is the abuse vector understood and bounded (rate-limit, cooldown, Humanness gate)?
- Did this PR add a leaderboard read? → Is it Redis-fronted with the SWR policy from docs/22?
- Did this PR change a badge definition? → Were the existing-award holders considered? (Don't silently revoke badges.)
- Does the share copy still make sense after replacing the user handle, the score, and the URL?
