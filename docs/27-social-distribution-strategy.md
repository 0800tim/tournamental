# 27 — Social distribution strategy

> The playbook that turns the auto-clip pipeline (`docs/14`) and the
> share-card library (`packages/social-cards/`) into a coordinated multi-surface
> distribution machine. Cadence per surface, hashtag strategy per locale,
> audience-tier rollout, compliance, and how every post wires back into
> the analytics doc (`docs/23`) for performance tracking.

## What this doc is *not*

- It is **not** the auto-clip pipeline (`docs/14` owns that — the *engine*).
- It is **not** the gamification spec (`docs/24` owns that — the *triggers*).
- It is **not** the analytics SDK (`docs/23` owns that — the *measurement*).

This doc is the strategy and operational rules layer that connects all three.

## The four surfaces

| Surface           | Format(s)          | Volume target / week  | Latency tolerance | Owner module           |
| ----------------- | ------------------ | --------------------- | ----------------- | ---------------------- |
| **TikTok**        | 9:16 video         | 30–80 (rate-limited)  | < 5 min from event| `apps/clip-publisher`  |
| **Instagram**     | Reels + Stories    | 25–60                 | < 5 min           | `apps/clip-publisher`  |
| **X (Twitter)**   | image + video      | 100–300               | < 2 min           | `apps/clip-publisher`  |
| **YouTube Shorts**| 9:16 video < 60s   | 6–14 (rate-limited)   | < 10 min          | `apps/clip-publisher`  |

A clip is rendered **once** by the auto-clip pipeline and forked into surface-specific
encodes. The share card (`@vtorn/social-cards`) is rendered once per kind per size
and re-used as Reels cover, X media, and YouTube Shorts intro slate.

## Posting cadence during a live tournament

Per match, the brand-channel cadence is:

| Phase            | Window        | Posts (per surface)               | Card kind                  |
| ---------------- | ------------- | --------------------------------- | -------------------------- |
| Pre-kickoff      | T-60 min      | 1 (IG Story poll, X teaser)       | `match-result` (no scores) |
| Kickoff          | T              | 1 (Telegram only — speed)         | n/a                         |
| First-half goals | per goal      | 1 per surface per goal            | `goal-clip`                |
| Half-time        | T+45 min      | 1 (X recap, IG Story half-time)   | `match-result` (current)   |
| Second-half goals| per goal      | 1 per surface per goal            | `goal-clip`                |
| Full-time        | T+90 min      | 1 per surface (result post)       | `match-result`             |
| Post-match recap | T+105 min     | 1 (TikTok / IG / Shorts each)     | `tournament-recap` (slice) |

**Daily digest** (at end of match-day): 1 carousel-style "top 3 goals of the day"
post on Instagram + YouTube Shorts compilation. Triggered by cron, not event.

**Weekly recap**: see `prompts/social/tiktok-clip-week-recap.md` and
`prompts/social/youtube-shorts-week-in-review.md`.

For *user* shares (auto-DM) the cadence is event-driven and per-user:

- Goal-clip: only when the user predicted that goal correctly.
- Bracket-locked: once, at lock time, with a 1-tap repost CTA.
- Leaderboard climb: only on threshold crosses (top-100, top-50, top-10, #1).
- Badge earned: every Bronze+ badge (Mythic / Platinum get extra-rich cards).
- Match result: only if the user submitted a prediction *and* opted in to result DMs.
- Tournament recap: every active user with > 5 predictions.

## Hashtag strategy

The hashtag set per post is computed as:

```
final_tags = primary_set + locale_set + tournament_set
```

Lists are committed in `data/hashtags/`. Each list is human-curated; the LLM caption
layer never invents tags (per `docs/14` § Captions and copy).

### Per surface

| Surface  | Tags in caption        | Tags in first comment | Tag style                                    |
| -------- | ---------------------- | --------------------- | -------------------------------------------- |
| TikTok   | 4–6                    | 0                     | Mix tournament + topic + algorithm (`#fyp`). |
| IG Reels | 5                      | 25 in first comment    | Caption tags weighted high, comment tags as breadth play. |
| X        | 1                      | 0                     | One tag only — multi-tag X posts get deboosted. |
| YT Shorts| 3 in description       | 0                     | Always include `#Shorts`.                    |

### Per locale

Locales we ship: **en**, **es**, **pt**, **fr**, **ar**, **ja**.

Locale add-on hashtags (these are appended to the surface set, never replacing):

| Locale | Sample tournament: World Cup 2026             |
| ------ | --------------------------------------------- |
| en     | `#WorldCup2026 #FIFA #Football #Soccer`       |
| es     | `#CopaDelMundo2026 #Mundial2026 #Fútbol`      |
| pt     | `#CopaDoMundo2026 #Futebol #Mundial`          |
| fr     | `#CoupeDuMonde2026 #Football #Mondial`        |
| ar     | `#كأس_العالم2026 #كرة_القدم`                 |
| ja     | `#W杯2026 #ワールドカップ #サッカー`              |

The locale set is selected from the *user* locale for user-shares, and from the
*tournament's primary audience locale set* for brand-channel posts (which can be
multi-locale: the brand-channel goal post for an ARG–FRA match runs en, es, fr).

### Per tournament

`data/hashtags/wc26.json` ships the canonical tag set:

```json
{
  "primary": ["#WorldCup2026", "#FIFA"],
  "topic": ["#Football", "#Soccer", "#WorldCupFinal"],
  "by_team": {
    "ARG": ["#Argentina", "#Vamos", "#Albiceleste"],
    "FRA": ["#France", "#LesBleus"]
  },
  "by_player": {
    "messi": ["#Messi"],
    "mbappe": ["#Mbappé", "#Mbappe"]
  }
}
```

The clip-publisher merges the primary + topic + active by-team + active by-player
sets into the surface-tag budget.

## Audience-tier rollout

User engagement bands map to outreach treatment (extending `docs/24` § Bot persona
policies). The engagement scorer (`docs/23`) computes the band in real time.

| Band            | Engagement score | Treatment                                                                                   |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| Cold            | 0–20             | Telegram nudge only. **No paid ad placement** (low signal, expensive). No auto-DM.          |
| Warm            | 20–50            | Auto-DM goal cards when relevant. Telegram nudges.  **Eligible for retargeting ads.**       |
| Engaged         | 50–80            | Auto-DM all share-cards. **Lookalike-audience seed for paid acquisition.** Personal email.  |
| Super-engaged   | 80+              | Personal email from "Tim". Early-access tokens. **Featured on the brand channel** (with consent). |

Paid placement filtering — for any retargeting / lookalike spend, the filter excludes:
- Users below 20 engagement (waste of ad spend).
- Users in jurisdictions where sportsbook affiliate retargeting is prohibited
  (per the compliance matrix below).
- Users who have opted out (`marketing_opt_out=true` in the user record).

## Compliance

### Meta / Instagram / Facebook

- **Branded-content**: brand-channel posts using user clips require explicit consent
  per `docs/24` § Sharing. The clip-publisher checks the user's `share_to_brand_channel`
  flag before any non-anonymous brand-channel push.
- **Sportsbook affiliate disclosure**: Meta requires an "Includes paid partnership"
  label for posts that link to a sportsbook affiliate. Brand-channel posts under no
  circumstances include affiliate links directly — they link only to `tournamental.com`,
  which routes per geo (per `docs/18` § Monetization).
- **Audience network restrictions**: real-money pool references are *prohibited* in
  ads under Meta's Gambling and Online Gaming policy. The publisher's pre-flight
  filter rejects ad copy containing the words `pool`, `stake`, `cashout`, `payout`.

### TikTok

- **Branded-content disclosure**: TikTok's Branded Content Policy requires the
  paid-partnership toggle for any compensated post. None of our auto-posts are
  compensated; the toggle is off.
- **Gambling content**: TikTok's Community Guidelines disallow promotion of betting
  services. Our brand-channel goal posts must not mention odds, stakes, or
  jurisdictional sportsbooks. The publisher's pre-flight filter is the same as Meta's.
- **AI / synthetic-content disclosure**: TikTok requires the AI-generated content
  toggle for fully synthetic content. Our auto-clips are 3D *visualisations* of real
  events, not synthetic events. Per the TikTok policy distinction (rendering vs.
  fabrication), we do not flip the AI toggle. We do include a description string
  (`Visualisation: Tournamental 3D replay`) on every brand-channel post.

### X

- X's gambling policy is jurisdictional. We honour:
  - **EU / EEA**: no sportsbook affiliate URLs from brand channel.
  - **US**: state-by-state — the publisher's pre-flight filter checks the
    affiliate's `restricted_states` list and skips the post if the brand channel's
    primary geo is in that list.
  - **AU / NZ**: gambling promotion requires explicit advertising approval; we do
    not run sportsbook ads from `@tournamental` in AU / NZ at all.

### YouTube

- **Made for kids**: every Shorts post sets `videoSelfDeclaredMadeForKids: false`.
- **Description disclosures**: visualisation note + StatsBomb attribution
  (per `docs/11`) on every post — auto-injected by the publisher.
- **Sportsbook affiliate**: YouTube's policy permits affiliate links in description
  if the linked site is licensed in the viewer's jurisdiction. The publisher uses a
  geo-routing landing page (`tournamental.com/sportsbook?geo=...`) that resolves at click
  time, not at post time.

### Sportsbook affiliate disclosure templates

Per-jurisdiction snippets the publisher appends to caption / description on
posts that *do* eventually route to an affiliate (none of the brand-channel
auto-posts in this initial set do; this is the template store for future
affiliate-active campaigns):

```
[US-NJ] 21+. Gambling problem? Call 1-800-GAMBLER.
[US-AZ] 21+. Gambling problem? Call 1-800-NEXT-STEP.
[UK]    18+. BeGambleAware.org. Please gamble responsibly.
[AU]    18+. Gamble responsibly. Visit gamblinghelponline.org.au.
[NZ]    18+. Problem gambling? Call 0800 654 655.
```

Source-of-truth: `data/compliance/disclosures.json`. Legal sign-off required
before flipping any of these on.

## Performance tracking

Every post the publisher creates is tagged with a campaign UUIDv7 minted at
post time. The tag flows through:

1. **Post URL**: every CTA URL carries `utm_content={{campaign.id}}` so click
   attribution survives.
2. **Engagement webhooks**: Meta / TikTok / X / YouTube each support
   webhook-on-engagement (or pull on a 60s cron where webhooks are unavailable).
   The `engagement-collector` worker (in `apps/clip-publisher/src/engagement/`)
   normalises responses into the `social_post_engaged` event from `docs/23`.
3. **Server log**: every `/v1/event` carrying `social_post_engaged` joins on
   `campaign.id` to recover the post that drove it.

### `social_post_engaged` event

Added to the canonical event list in `docs/23`. Required fields:

| Field            | Notes                                                |
| ---------------- | ---------------------------------------------------- |
| `campaign_id`    | UUIDv7 minted at post time.                          |
| `surface`        | `tiktok` / `instagram` / `x` / `youtube`.            |
| `post_id`        | Native platform post id.                             |
| `event_kind`     | `view` / `like` / `share` / `comment` / `save` / `click`. |
| `count_delta`    | Engagement increment since last poll.                |
| `viewer_country` | From the platform's analytics API.                   |

The publisher persists post-id ↔ campaign-id ↔ user-id mapping in Postgres so
the engagement event has full provenance.

### Weekly digest

A Monday-9am cron emits the `weekly-social-digest.md` report into
`apps/admin-dashboard/reports/` with:

- Top 10 posts by `(views × ctr × signup_conversion)` weight.
- Surface mix and per-surface lift since the prior week.
- Hashtag-set winners (which curated set produced the best
  signups-per-impression).
- Underperforming creative — posts in the bottom decile that we'll cull from
  the rotation.

The digest is rendered server-side and posted into the team's Telegram channel.
Tim reads it Monday at 9:01am and tunes the cadence accordingly.

## Operating limits

- Each user receives at most **3 auto-DM cards per day** to prevent fatigue.
- Brand-channel posts are rate-capped to **15/hour per surface** to avoid
  TikTok/IG anti-spam flags.
- A single goal can produce *at most* 4 posts (one per surface). The publisher
  dedups on `(event.id, surface)`.
- The publisher applies an **exponential backoff** on platform 429 / 5xx
  responses; failed posts after 3 attempts go to the human-review queue
  (per `docs/14` § Acceptance criteria).

## What we deliberately don't do

- **Cross-post identical text to all surfaces**. Each surface gets its own
  caption variant. Identical-cross-post is the most-deboosted pattern on every
  algorithm.
- **Schedule posts more than 24h ahead**. The cadence is real-time-event-driven
  during tournaments; pre-scheduling makes us miss live moments.
- **Comment / DM with end users from the brand channel**. The Telegram bot
  handles user-side conversations (per `docs/13`). The brand channel is
  broadcast-only.
- **Buy comments / engagement**. Banned across the board.

## Cross-checks

- **`docs/14`**: clip-pipeline produces the underlying video; this doc
  consumes its output.
- **`docs/23`**: every post fires events that flow into the engagement scorer
  and the analytics warehouse.
- **`docs/24`**: triggers, share cards, referral URLs, audience bands —
  this doc operationalises them across the four social surfaces.
- **`docs/18`**: monetisation rules — what kinds of CTAs are allowed on
  which surface in which jurisdiction.
- **`docs/20`**: bot / humanness gating — auto-DM rollouts are gated by
  the recipient's Humanness Score.

## Sources

- [Meta Branded Content Policies](https://www.facebook.com/business/help/788160621327601)
- [TikTok Branded Content Policy](https://www.tiktok.com/business/en/blog/branded-content-policy-update)
- [TikTok AI-generated content disclosure](https://newsroom.tiktok.com/en-us/new-labels-for-disclosing-ai-generated-content)
- [X Sensitive Media Policy](https://help.twitter.com/en/rules-and-policies/media-policy)
- [YouTube Shorts policies and best practices](https://support.google.com/youtube/answer/10059070)
- [GA4 UTM-parameter spec](https://support.google.com/analytics/answer/10917952)
