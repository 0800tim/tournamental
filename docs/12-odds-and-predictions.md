# 12 — Odds, Predictions, Leaderboards, Sweepstakes

> Gamification layer on top of the rendered match. Pulls live odds from public/free sources (Polymarket, The Odds API, API-Football). Lets users predict outcomes, accumulate points and streaks, climb global / country / friend leaderboards, and self-organise office sweepstakes with gold / silver / bronze payouts. Affiliate links to regulated sportsbooks where geography permits.

## What this layer adds

Three product surfaces hanging off the same canonical match stream:

1. **Live odds inline.** Each rendered match shows current pre-match and in-play markets — moneyline, total goals, next goal scorer, exact final score, etc. — sourced from public APIs. Odds tick during the rendered match the same way they would on a sportsbook screen.
2. **Free predictions game.** Users predict match outcomes (and prop bets) before kickoff and during play, get points for correct calls, build streaks, climb leaderboards. No money handled by us.
3. **Self-organised sweepstakes.** Friend groups and offices create private pools — entry fee, prize structure (winner-takes-all, gold/silver/bronze, custom). We track standings; we do **not** handle money. Settlement is on the participants (Wise, Venmo, PayPal, crypto, IOU). This sidesteps gambling regulation in most jurisdictions and lets the product ship globally.

Affiliate links to regulated sportsbooks (Bet365, DraftKings, FanDuel, etc.) appear next to odds where the user's region allows them and we have an affiliate deal. Click-through is the entire monetisation surface; we never operate as a book.

## Data sources

### Polymarket — primary public odds source

[Polymarket](https://polymarket.com) runs a fully public, free, no-auth REST + WebSocket API at `clob.polymarket.com` and `gamma-api.polymarket.com`. Markets cover most major sporting events. Implied probability comes from the YES-share price (e.g. "Argentina to win 2026 World Cup" trading at 0.18 → 18% implied). Real liquidity, real order books, sub-100ms WebSocket updates.

Key endpoints:

- `GET /markets` — list all markets, filter by tag (`tag=sports`, `tag=worldcup`).
- `GET /markets/{condition_id}` — full market detail.
- `GET /prices/{token_id}` — current YES/NO price.
- `WSS /ws` — subscribe to price-update events.

A small TS client lives in `apps/odds-fetcher/polymarket.ts`, polls Polymarket every 1s for active markets matching the live `match_id`, and republishes them as a side-channel to the spec stream:

```ts
{ "type": "event.market_update", "t": 754000,
  "source": "polymarket",
  "market_id": "0x...",
  "question": "Will Argentina win this match?",
  "yes_price": 0.62, "no_price": 0.38,
  "volume_24h": 124500.50,
  "url": "https://polymarket.com/event/..."
}
```

This is a proposed v0.2 spec extension — `event.market_update` — added cleanly under the existing `event.*` family. Renderers ignore it if they don't care about odds; the prediction UI renders it as a moving line chart.

### The Odds API — bookmaker odds aggregator

[The Odds API](https://the-odds-api.com) aggregates 30+ bookmakers (Bet365, DraftKings, FanDuel, William Hill, Betfair, Pinnacle, etc.) into a single JSON API. **Free tier: 500 requests/month**, paid tiers cheap. With 1-minute caching at our side and ~10 active concurrent matches at peak, free tier is enough for development; a $30/month tier covers production.

Coverage includes pre-match and in-play moneyline / spreads / totals. Doesn't cover all niche prop bets. Critically, the API explicitly permits monetisation via affiliate links to the sourced bookmakers.

Endpoint shape: `GET /v4/sports/soccer_fifa_world_cup/odds?regions=us,uk,eu,au&apiKey=...`

Republished into the spec as `event.market_update` with `source: "the-odds-api"` and a per-bookmaker breakdown.

### API-Football — secondary, fixtures-and-stats

[API-Football](https://www.api-football.com) has a generous free plan (100 req/day) for fixtures, lineups, live scores, statistics. Useful as a redundant source for match metadata when StatsBomb open data isn't available (i.e. live fixtures we're rendering from a non-StatsBomb producer). Also provides a basic odds endpoint.

### Bet365, DraftKings, FanDuel — affiliate, not data

We do not scrape these directly. Their data comes via The Odds API (which licenses redistribution). Their *affiliate programs* are what we link to:

- **Bet365 Partners** ([affiliates.bet365partners.com](https://affiliates.bet365partners.com)) — most countries, hardest to get accepted into.
- **DraftKings Affiliates** — US-only.
- **FanDuel Partner Program** — US-only.
- **William Hill / Caesars Affiliate** — US/UK.
- **Stake.com Affiliates** — crypto-friendly, global.

Per-region routing decides which affiliate link the user sees. Where no affiliate is available (e.g. user in a jurisdiction where sports betting is restricted), we just don't show one. The Polymarket prediction-market link works almost everywhere because it's not a sportsbook.

### Affiliate routing

A small service `apps/affiliate-router/`:

- Geo-locates the user from request IP (Cloudflare provides `cf-ipcountry`).
- Looks up the best affiliate for that country + market.
- Returns a wrapped URL with our `tag` parameter for tracking.
- Falls back to "no affiliate available" gracefully — never break the UX over a missing link.

Click-tracking is server-side in Postgres so we can attribute conversions ourselves rather than trust each affiliate's dashboard. Standard `clicks(user_id, market_id, affiliate_id, ts)` table.

## Predictions game

### Prediction types per match

- **Result** — Home / Draw / Away. 5 points correct.
- **Exact score** — e.g. "2–1". 25 points correct.
- **First goalscorer** — player ID. 15 points correct.
- **Total goals over/under** — over/under 2.5. 3 points correct.
- **Both teams to score** — yes/no. 3 points correct.
- **In-play prop** (mid-match): "Next goal in next 10 min" — 5 points correct, locks immediately on submit.

Tournament-level (predicted before tournament starts):

- **Winner** — 100 points.
- **Top scorer** — 50 points.
- **Bracket prediction** — 200 points for a perfect bracket; partial credit per correct round.

### Streaks and bonuses

- **Hot streak**: 3+ consecutive correct results → 1.5× multiplier on next correct call.
- **Cold streak forgiveness**: lose only 50% multiplier penalty after a wrong call (we want users to keep playing).
- **Underdog bonus**: correct prediction against the consensus (Polymarket implied probability < 30%) → 2× points.
- **Perfect day**: get every prediction right on a tournament matchday → 100 bonus points.
- **Perfect bracket**: get every match in the entire tournament correct → headline prize (real or virtual depending on legality).

### Badges (bragging rights)

Badges are achievements that anyone can show off. Earned automatically by the scoring engine; visible on profiles, embedded in shareable cards.

Starter set (the snapshotter awards these by walking new prediction outcomes):

- **First Blood** — first correct prediction.
- **Hot 5** — 5-prediction streak.
- **Hot 10** — 10-prediction streak.
- **Hot 25** — 25-prediction streak.
- **Underdog Caller** — correct prediction against a Polymarket implied probability < 25%.
- **Crystal Ball** — exact-score correct.
- **Hat-trick of Hat-tricks** — correct first-scorer in 3 consecutive matches.
- **Country Champion** — top of your country leaderboard at end of any matchday.
- **City Mayor** — top of your city leaderboard at end of any matchday.
- **Bracket God** — perfect bracket through a tournament round.
- **Group Stage Genius** — perfect group-stage bracket.
- **Final Four** — predicted all four semi-finalists correctly.
- **Comeback Kid** — correctly predicted a result where Polymarket flipped favourite mid-match.
- **The Pundit** — 100 lifetime correct predictions.
- **The Oracle** — 1,000 lifetime correct predictions.

Each badge is just a string ID + an animation tier (bronze, silver, gold, platinum) + a PNG asset. New badges are additive and ship in a small `badges.json` config that the renderer fetches from the static CDN, so we can add them mid-tournament without redeploying.

### Shareable cards (viral mechanics)

Every interesting moment generates a shareable image. Click "Share" → choose Facebook, Instagram, WhatsApp, X, Telegram, or copy-link.

Generated server-side as 1080×1080 PNG (square — works on every platform) and 1080×1920 PNG (story format) using `@vercel/og` or a small Satori-based service. Each card includes:

- The user's avatar and name.
- The achievement (e.g. "Tim called Argentina to win 3–2 vs France. Crystal Ball badge unlocked.").
- A render of the moment from the 3D scene (a frame grab from the renderer at the relevant `t_ms`).
- Tournament Bot avatar in the corner with a one-line quip.
- Tracking link with `?ref=<user_id>` for invite credit.

Card URLs are content-addressed: `/v1/static/cards/<sha256>.png`. Generated on demand once and CDN-cached forever (any change in source data produces a different hash).

WhatsApp share is the highest-conversion channel for friend-network growth — preserve link previews via OpenGraph tags pointing at the card image. Telegram share goes through the bot directly using the `inline mode` API ([doc 13](13-telegram-bot-and-auth.md)).

### Save and lockout rules

> User copy reads "Save"; the technical / server-side concept is the
> `kickoff_lockout` — they're the same policy, different vocabulary.
> Internal fields like `lockedAt`, `oddsAtLock`, `lockMultiplier()` and
> the 409 `match_already_started` error code stay as-is.

- Pre-match predictions are changeable until official kickoff time
  pulled from the fixture provider. Every save snapshots the
  odds-at-save and updates the user's `lockedAt` for that pick.
- In-play predictions lock the moment they're submitted (the prompt
  window is shorter than a save round-trip).
- No edits after kickoff. The server rejects with `match_already_started`
  (409); the client surfaces a "this match has already started" banner.
- Late submissions rejected by the server; the client warns "kicks off
  in N minutes" approaching kickoff.

## Storage architecture (no SQL — flat files + KV)

The gamification layer follows the same write-once-run-everywhere principle as the match stream: hot writes go to an in-memory KV store; periodic snapshots flush flat JSON files; Cloudflare caches the JSON for tens of seconds; millions of viewers pay zero per-viewer load.

```
   Bot/Web write API ─▶ Redis (hot KV) ─▶ Snapshotter ─▶ /static/v1/*.json ─▶ Cloudflare ─▶ users
                              │  every 10s (leaderboards) / 30s (profiles) / 5s (live points)
                              ▼
                       (optional) S3 / disk archive for long-term replay
```

Reads from clients are *always* against the static JSON URLs. The KV store is never on the read hot path. This is the same pattern the spec stream uses; we reuse it.

### KV (Redis) hot keys

```
user:<user_id>                   → JSON blob: profile, points, streak, badges
user_by_tg:<telegram_id>         → user_id (for auth lookup)
friends:<user_id>                → set of user_ids
predictions:<user_id>:<match_id> → JSON blob: predictions for that user/match
predictions_by_match:<match_id>  → set of user_ids who predicted (for fast scoring)
pool:<pool_id>                   → JSON blob: pool config + members
pool_members:<pool_id>           → set of user_ids
points_live:<tournament_id>      → sorted set, score = current points (ZSET)
points_country:<tournament_id>:<country> → sorted set
points_city:<tournament_id>:<geohash5>   → sorted set (5-char geohash ≈ city scale)
points_team:<team_id>            → sorted set (e.g. "fans of Argentina")
```

Redis sorted sets give O(log N) leaderboard updates and O(log N + M) range reads. Memory footprint stays small — even 1M users at ~200 bytes each fits in 256MB. Redis is the *write authority*; it's recoverable from snapshots if it ever crashes.

### Static JSON files served by CDN

Snapshotter writes these on a schedule. Every file is content-addressed by a version stamp so the CDN can cache aggressively:

```
/v1/static/leaderboards/
   global.json                                  # top 1000 globally
   country/<ISO>.json                           # top 500 per country
   city/<geohash5>.json                         # top 100 per city
   team/<team_id>.json                          # top 500 per team affinity
   tournament/<tid>/global.json                 # tournament-scoped
   tournament/<tid>/country/<ISO>.json
   tournament/<tid>/round/<round>.json          # e.g. group_stage, ko_round_of_16

/v1/static/profiles/
   <user_id>.json                               # public profile
   <user_id>/predictions/<tournament_id>.json   # user's prediction history

/v1/static/pools/
   <pool_id>/leaderboard.json                   # pool-internal leaderboard
   <pool_id>/summary.json                       # public summary

/v1/static/markets/
   <match_id>.json                              # current odds, refreshed every 5s

/v1/static/manifests/
   tournament/<tid>.json                        # list of fixtures, current state
   live.json                                    # which matches are live now
```

Update cadence:

- **Leaderboards**: every 10s during live matches, every 60s otherwise. Cache-Control: `public, max-age=10, stale-while-revalidate=20`.
- **Markets**: every 5s during live matches. Cache-Control: `public, max-age=5, stale-while-revalidate=5`.
- **Profiles**: every 30s. Cache-Control: `public, max-age=30`.
- **Manifests / fixtures**: every 60s.

Browsers either poll these JSON URLs or subscribe to a thin SSE channel for change-notifications — see [doc 13](13-telegram-bot-and-auth.md) for the SSE design (it's the same channel the bot uses to fan out).

### Why no SQL

Two reasons. First, the access pattern is overwhelmingly read-heavy and read-cacheable. SQL excels at flexible ad-hoc queries; we don't have those — every read is a known-shape leaderboard or profile lookup. Second, the snapshot model is trivially horizontally scalable: the KV is the single source of truth, snapshots are stateless transformations, and serving is on the CDN. There's no read-replica fanout to manage, no query plan tuning, no migration tax.

Long-term archival of every prediction for analytics goes to a compressed JSONL file per day, sitting on disk or S3. Query that with DuckDB when needed — no database server to operate.

## Profiles, friends, leaderboards (data shapes)

### User profile JSON

```json
{
  "user_id": "u_01HXM2...",
  "display_name": "Tim",
  "avatar_uri": "https://cdn.example/avatars/u_01HXM2.png",
  "country": "AU",
  "city_geohash5": "r3gjc",
  "team_affinity": ["ARG", "club_river_plate"],
  "created_at": "2026-05-09T12:34:56Z",
  "telegram_id": 1234567890,
  "telegram_username": "tim_t",
  "total_points": 1247,
  "current_streak": 5,
  "longest_streak": 11,
  "perfect_days": 2,
  "badges": ["first_blood","hot_5","underdog_caller"],
  "ranks": {
    "global": 8423,
    "country": { "AU": 312 },
    "city":    { "r3gjc": 14 },
    "team":    { "ARG": 1102 }
  }
}
```

`ranks` is a denormalised cache for fast profile-page render — recomputed on snapshot. Authoritative ranks come from the leaderboard files.

### Friend network

`friends:<user_id>` in Redis is a simple set; no separate "friendships" table. Symmetric — when A adds B, both sets are updated. Mutual-only friend graph; no follower/following asymmetry. Pending invites are kept in a parallel `friend_invites:<user_id>` set with a TTL.

Friend leaderboards aren't pre-snapshotted (would explode in cardinality). They're computed at request time by a tiny edge worker that takes `friend_ids[]` from a signed cookie, fetches each profile JSON in parallel from CDN, sorts, and returns. Sub-100ms for typical friend counts (<150).

### Granular leaderboards

The same prediction event drives many leaderboards because each user is tagged with multiple group memberships:

- **Global** — every user on the platform.
- **Country** — by ISO code.
- **City** — by 5-char geohash (~5km cells; coarse enough to be private, fine enough to be local).
- **Team affinity** — every user picks 1–3 teams they support; each predicts a separate leaderboard.
- **Friends** — runtime computed.
- **Pools** — private leaderboards within sweepstakes pools.
- **Tournament** — scoped to a specific tournament_id.
- **Round** — scoped to round within tournament (group stage, R16, QF, SF, final).
- **Day** — daily leaderboards for "best prediction day" awards.

Each is a Redis ZSET; the snapshotter dumps the top-N to a static JSON file. Cardinality is bounded — a tournament with 500 fixtures and 200 cities surfaces ~100k JSON files at peak, all under 50KB each, all immutable for their TTL window.

### Predictions JSON

```json
{
  "user_id": "u_01HXM2...",
  "tournament_id": "fifa-wc-2026",
  "match_id": "wc26-arg-fra-final",
  "predictions": [
    { "type": "result",        "value": "home", "locked_at": "2026-...", "resolved": "correct", "points": 5,  "multiplier": 1.5 },
    { "type": "exact_score",   "value": "3-2",  "locked_at": "2026-...", "resolved": "incorrect","points": 0 },
    { "type": "first_scorer",  "value": "P_MESSI", "locked_at": "2026-...", "resolved": "correct","points": 22, "multiplier": 1.5 }
  ]
}
```

Append-only. "Edits" before lock create a new entry with `superseded_by` pointing at the prior one — the record is immutable history.

## Sweepstakes (self-organised pools)

The legally-clean version: a pool is a tracker, not a custodial wallet.

Pool data shape (stored in Redis at `pool:<pool_id>`, snapshotted to `/v1/static/pools/<pool_id>/...`):

```json
{
  "pool_id": "p_01HXN3...",
  "name": "Sydney office WC sweepstakes",
  "creator_id": "u_01HXM2...",
  "tournament_id": "fifa-wc-2026",
  "entry_amount": 10,
  "currency": "AUD",
  "prize_structure": "gold_silver_bronze",
  "prize_split": { "1": 0.6, "2": 0.3, "3": 0.1 },
  "invite_code": "BLUE-WOMBAT-7Q",
  "status": "open",
  "members": [
    { "user_id": "u_01HXM2...", "paid": true,  "joined_at": "..." },
    { "user_id": "u_01HXM3...", "paid": false, "joined_at": "..." }
  ],
  "created_at": "2026-05-09T..."
}
```

UX flow:

1. User creates a pool, sets entry amount and prize structure ("Winner takes all", "60/30/10 gold-silver-bronze", "1st place gets 100%, 2nd place's money refunded — custom").
2. Generates an invite link / Telegram deep-link. Friends join.
3. Each member self-marks "I paid" once they've sent the entry fee to the pool's organiser via whatever method the group uses (Wise, Venmo, PayPal, crypto, cash).
4. Pool locks at tournament start. Predictions count toward both global leaderboard and the pool's private leaderboard.
5. Tournament ends; pool results computed automatically. The organiser (creator) marks each rank as "paid out" once they've physically Wise/Venmo'd the winners.

We are explicitly the *coordinator*, not the *bank*. This avoids 90% of the regulatory surface. We're not gaming-licensed and never claim to be. The friction of self-pay is the feature, not a bug.

For users who want a custodial alternative, we link them to **Polymarket** as a trade-this-outcome flow — Polymarket is a regulated prediction market (US-restricted, available globally otherwise) and handles its own KYC + custody. Affiliate referral if available.

### Office-style preset

A "10-person office sweepstakes" preset configures: 10 max members, $10 entry, winner-takes-all (or 60/30/10), defaults to the user's country's tournament. One click.

## Anti-cheat and integrity

- **Server-side time authority.** The lock time for a prediction is whenever the *server* receives it, not what the client claims.
- **Edit history.** Predictions are append-only; "edit" creates a new row tagged `superseded_by` so a user can change their mind before lock but the audit trail is durable.
- **Point recomputation.** Points are not stored on `users` directly; they're a sum-over-predictions computed nightly and cached. If we ever discover a settlement bug, recomputing fixes everyone's totals atomically.
- **Settlement source of truth.** Match results come from a single configurable provider (StatsBomb for historic, API-Football for live, manual override for the long tail). Disputed settlements have a documented appeal flow.

## Render integration

The renderer's HUD has a slide-out panel powered by this module. Two states:

- **Logged out**: shows current odds inline, "Predict to win" CTA, "Sign in via Telegram" button (see [doc 13](13-telegram-bot-and-auth.md)).
- **Logged in**: shows user's prediction (locked or open), live point swing (animated based on current score vs prediction), friend leaderboard delta, current streak, "Top up your pool" reminder if active.

Spec extension `event.market_update` is consumed by the panel's odds chart. The renderer emits a custom DOM event (`simsports:prediction-changed`) that the panel reacts to so prediction state stays in sync without a global state library on the renderer side.

## What we deliberately don't build

- **Custodial wallets.** No money custody. Ever.
- **In-app payments.** Even Stripe Connect would put us inside payment regulation. Sweepstakes settle off-platform.
- **An odds book of our own.** We display third-party odds and Polymarket prices. We never set our own prices.
- **A KYC pipeline.** Auth is Telegram (doc 13); no government IDs, no proof-of-address.
- **Prize fulfilment for the perfect-bracket headline.** Either it's a virtual trophy + bragging rights, or a sponsor we partner with provides the physical prize and handles fulfilment / tax.

## Acceptance criteria

- [ ] Polymarket prices appear on the renderer's odds panel within 1s of a price tick on Polymarket.
- [ ] User can submit a pre-match Result + Exact-score + First-scorer prediction in under 10s from a logged-in state.
- [ ] In-play "next goal in 10 min" prediction locks immediately and resolves at the 10-min mark.
- [ ] Global leaderboard renders for 100k users in <300ms (materialised view).
- [ ] Country leaderboard correct after a points recomputation.
- [ ] Friend leaderboard correct including "you" highlighted.
- [ ] Pool creation → join via invite link → lock → settle → results post.
- [ ] Affiliate link click recorded in `clicks` table; geo-routed correctly for a US, UK, AU, and DE test IP.

## Sources

- [Polymarket API documentation](https://docs.polymarket.com/api-reference/introduction)
- [Polymarket CLOB Python client — GitHub](https://github.com/Polymarket/py-clob-client)
- [The Odds API](https://the-odds-api.com/)
- [API-Football](https://www.api-football.com/)
- [Bet365 Affiliate Program](https://affiliates.bet365partners.com/)
