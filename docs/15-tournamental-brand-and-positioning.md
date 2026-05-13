# 15, Tournamental: Brand and Positioning

> The product brand for the gamification + prediction layer is **Tournamental**. The 3D match renderer + spec stream remain the technical backbone (formerly under the working name "SimulatedSports") but the consumer-facing product, marketing, and domain are Tournamental. This doc nails down what Tournamental is, what it isn't, and how it's positioned, including the regulatory frame around prediction markets.

## Name and domain

- **Tournamental** (uppercase V, lowercase torn).
- Domain: **tournamental.com** (acquired).
- Reads as: virtual tournament, verified tournament, vortex tournament. All three meanings are intentional; the brand line picks one or stacks them.
- Visual mnemonic: a tornado / vortex (live odds and predictions swirling), a chevron-V (forward velocity), or both.

### Brand expansion

When a longer form is needed: **Tournamental, Verified Tournament Oracle Network**.

This rolls cleanly off the page on About sections, pitch decks, and footer fine-print, while the everyday brand stays the four-letter Tournamental.

## Tagline

The recommended primary tagline:

> **Predict the tournament. Beat the market. Prove it.**

Three short sentences that capture the entire product. "Predict" = the activity. "Beat the market" = the skill differentiator (vs other tipping comps). "Prove it" = the verification + reputation story.

Backup taglines for context-specific use (campaigns, App Store, social):

- *No more pub talk. Lock your prediction.*
- *If you knew it, you should have locked it.*
- *Where fans become verified oracles.*
- *Beat your mates. Beat the market. Beat the experts.*
- *The live tournament prediction game powered by real odds.*
- *Your predictions. Locked. Scored. Verified.*
- *Call the result before the crowd does.*
- *The tournament game for people who think they know better.*

The killer copy beat, the *one line* designed to make a reader nod and screenshot:

> **Everyone says they knew what would happen. Tournamental proves who really did.**

## What Tournamental is

A live tournament intelligence game where fans compete to prove who can read the tournament better than the crowd, the experts, and the market, match by match, prediction by prediction, with every locked call timestamped and verifiable.

Three product surfaces, in priority order:

1. **The prediction game.** Free-to-play. Pre-match and live-match predictions across 10 game modes (see [doc 16](16-game-modes-and-scoring.md)). Scored against live market implied probabilities, so calling a 25%-implied underdog correctly is worth more than calling a 90% favourite. Personality-flavoured leaderboards. Verified prediction history.
2. **The watch-along world.** The 3D match renderer (docs [02](02-spec.md), [04](04-renderer.md)), the same scene every viewer sees, with stylized avatars of the players, live commentary remixed, and inline odds + crowd predictions overlaid.
3. **The reputation network.** Long-term Prediction IQ (see [doc 17](17-vstamp-and-prediction-iq.md)). Every user accrues a verifiable record across tournaments and sports. Over time this becomes the social proof, the shareable identity asset, that no other tipping comp produces.

## What Tournamental is not

- **Not a betting platform.** Tournamental never operates as a sportsbook. We never custody user money, never settle wagers, never appear in any list of betting operators.
- **Not a Polymarket front-end.** We use Polymarket's *public price data* as a market layer for scoring difficulty and the Crowd-vs-Market display. We surface external links to Polymarket *only where it is legal for the user to use Polymarket*, with clear third-party labelling.
- **Not a fantasy-points trader.** Points are not redeemable for cash, gift cards, crypto, or any monetary instrument. They are bragging rights, leaderboard rank, and reputation, full stop.
- **Not a single-tournament novelty.** The architecture supports any tournament across any sport (and eventually non-sport prediction events: elections, awards, entertainment). Tournamental is the platform; tournaments cycle through it.

## Regulatory and legal positioning

Tim is operating from New Zealand. New Zealand has flagged Polymarket and Kalshi as operating illegally under existing NZ gambling laws (`reporting from 2024–2025`), and Polymarket itself geo-restricts order placement in some jurisdictions. This shapes how Tournamental ships:

### Hard separation between game and external markets

Two product layers that share no money, no balances, and no settlement:

| Layer | What it is | Money? | Where it ships |
|-------|------------|--------|----------------|
| **Tournamental predictions** | Free-to-play game; points only; non-redeemable; leaderboards; badges; Prediction IQ | **No.** Never custodial; never redeemable. | Globally. |
| **External markets layer** | Read-only display of Polymarket implied probabilities + Bookmaker odds via The Odds API; affiliate links to Polymarket / Bet365 / DraftKings / etc. | We don't handle it. Affiliate clicks open a third-party site that handles its own KYC + settlement. | Affiliate links shown **only in jurisdictions where the destination operator is legal for that user.** Geo-routing in [doc 12](12-odds-and-predictions.md). |

In NZ specifically: market *odds* are shown (data is not gambling); affiliate *links* to Polymarket are not surfaced; sweepstakes pools are non-custodial (users self-settle off-platform).

### Standard disclosure copy

Every page that surfaces market data:

> Tournamental is a free-to-play tournament prediction game. Live market odds are shown for informational and gameplay purposes only. Real-money prediction markets are operated by third-party platforms where legally available; Tournamental is not a betting platform.

In affiliate-link contexts:

> Opens a third-party operator's site. Availability and legality vary by jurisdiction. Tournamental is a free-to-play prediction game and does not offer or facilitate real-money wagers.

### Things we explicitly avoid

- Calling a prediction a "bet", a "stake", or a "wager" anywhere in the product, marketing, or terms.
- Implying Tournamental points have any monetary value.
- Showing odds in fractional / American / decimal format without an obvious "implied probability" framing, we lead with implied probability so it reads as data, not a price.
- Offering "guaranteed return" copy or any claim that engaging with markets makes money.
- Allowing pool prizes to flow through our infrastructure. Pools are coordinator-only, we track, members settle.

This is not legal advice. The operator (Tim) is responsible for confirming with NZ counsel before launch; the framing in this doc is engineered to minimise the surface, not to constitute compliance.

## Monetisation paths

> **See [doc 18](18-monetization.md) for the full monetization model with revenue scenarios, affiliate routing engine spec, and realistic ramp expectations. See [doc 19](19-open-source-and-contributor-revenue.md) for the open-source structure and contributor revenue share.**

Tournamental ships free. Revenue lives in six buckets (sponsored tournaments + native ads, Tournamental Pro subscription, B2B white-label, creator leagues, geo-restricted affiliate routing, data licensing + Verified Pundit programme), none of which require us to operate as a sportsbook or financial service. Net revenue flows to **Tournamental** and is partially redistributed to upstream contributors via Drips Network. Quick summary of each lane below; full treatment in doc 18.

### 1. Affiliate revenue (geo-restricted)

Outbound clicks from the markets layer to legal-in-jurisdiction operators. Tracked server-side in our own clicks table; we do not depend on each operator's dashboard. Top targets:

- **Polymarket**, global where it operates, but shadow-flagged in NZ; only surface to non-NZ users.
- **Bet365 Partners**, broadest accepted-countries list of the major sportsbooks.
- **Stake.com**, crypto-native, available in many jurisdictions where fiat books aren't.
- **DraftKings, FanDuel, Caesars**, US states with regulated sports betting.
- **Sportsbet, TAB**, AU / NZ regulated bookmakers (TAB is the only legal NZ operator).

Net revenue per click is highly variable; CPA deals beat revshare for first-launch unless we have proven retention.

### 2. Tournamental Pro (subscription)

For users who want more than the free game. Suggested tier: ~$9–14/month or $79/year.

Pro includes:

- Advanced odds-movement charts across multiple operators.
- AI Match Briefing + AI Prediction Coach + AI Post-Match Debrief (free tier sees a basic version).
- Prediction analytics and history export.
- Private league admin tools (custom branding, large league sizes, prize structures).
- Custom alerts (market-moved-15% notifications, "your friend just predicted Argentina to win").
- Leaderboard filters and historical-tournament search.
- Early access to new sport modules.

Free tier remains genuinely useful, Pro is for the obsessives.

### 3. Sponsored tournaments and challenges

Brands sponsor named challenges within a tournament. Examples:

- "Red Bull Comeback Challenge", points 2× for correct comeback predictions.
- "Nike Underdog Cup", separate leaderboard for predictions on teams below 30% implied probability.
- "TAB Alternative Free Prediction League", TAB-branded free league with TAB-provided prizes.
- "Pub World Cup Challenge", geographically-flavoured local pub league.
- "Creator Prediction Cup", tournament between fans of streamers.

Sponsorship deals include logo placement in the dedicated leaderboard, the badge artwork for the challenge, and inclusion in the social card visuals. Not in the core in-scene HUD.

### 4. White-label fan engagement

The whole Tournamental stack, predictions game, leaderboards, badges, private leagues, share cards, optional renderer, sold as a white-label product to:

- Sports clubs running fan-engagement campaigns.
- Broadcasters wanting an interactive watch-along layer.
- Pubs / bars running their own World Cup pools.
- Fantasy sports communities.
- Discord servers with engaged sports communities.
- Schools and universities running internal tournaments.

Pricing structure is per-tournament + per-active-user, with a heavy discount for educational and not-for-profit deployments.

### 5. Creator leagues

Influencers and streamers run their own private leagues with their audience. The creator owns the league branding; Tournamental provides the engine. Revenue split:

- Free leagues: Tournamental keeps any incidental affiliate revenue from market-link clicks within the league.
- Premium leagues (creator charges audience): Tournamental takes ~15% of subscription revenue + Stripe fees pass through.
- Sponsored creator leagues: 50/50 split on sponsor fees between creator and Tournamental.

## Visual identity (sketch)

To be finalised by a designer; this is the brief:

- **Wordmark**: "Tournamental" in a confident geometric sans (Inter, Geist, Söhne, or similar). The "V" can be styled as a chevron / cone shape, directional, fast.
- **Mark / monogram**: a small vortex / spiral icon, or a stylized stacked V (like a chevron tornado). Works as a 16×16 favicon and in-bot avatar.
- **Palette**: high-contrast. Suggested base, deep navy or near-black for backgrounds; an electric accent (cyan, magenta, or lime) for CTAs and live data; muted neutrals for body. Avoids the green-felt sportsbook aesthetic deliberately.
- **Typography**: a single sans for everything. Number-heavy displays (leaderboards, odds) use a tabular-number variant.
- **Tone**: confident, slightly cheeky, never heavy-handed. The Tournament Bot persona ([doc 13](13-telegram-bot-and-auth.md)) embodies this.

The renderer's stylized avatars and the gamification UI share the same palette so Tournamental feels like one product, not three.

## Long-term vision

Tournamental is sports-first because tournaments are a natural fit for the game loop, but the architecture (prediction → lock → market-difficulty score → verifiable receipt → reputation) generalises:

- **Other sports**, rugby, cricket, tennis, basketball, esports, motorsport, AFL/NFL.
- **Election cycles**, calls before pollsters / markets settle. Sensitive, but the verification mechanic is exactly the right shape.
- **Awards and culture**, Oscars, Grammys, music charts, eurovision.
- **Reality TV outcomes**, already a category Polymarket lists; an obvious expansion.
- **Community-defined prediction events**, "will our company hit Q4 numbers", "will the new product launch hit X downloads in week 1". White-label-flavoured.

Across all of these, Tournamental becomes:

> A verified record of what you predicted before everyone else knew the answer.

That's the long-term product, and it's what makes the early sports-only launch worth getting right.

## Repo and naming hygiene

The working folder is still `/Users/timthomas/Documents/Claude/Projects/SimulatedSports`. We can rename later; for now, internal modules use these names:

- **`packages/spec`**, the JSON message contract.
- **`apps/web`**, the Tournamental web app (renderer + gamification UI).
- **`apps/mock-producer`**, **`apps/stream-server`**, **`apps/video-ingest`**, **`apps/feed-adapter`**, match data layer.
- **`apps/game-service`**, predictions, leaderboards, badges (doc 12, agent J).
- **`apps/tournament-bot`**, Telegram bot and auth (doc 13, agent K).
- **`apps/clip-pipeline`**, **`apps/social-distributor`**, clips and social (doc 14, agent L).
- **`apps/vstamp-service`**, Merkle batching and chain anchoring (doc 17).

External brand on every consumer surface: Tournamental. Internal package names can stay neutral.

## Acceptance criteria for "Tournamental brand applied"

- [ ] tournamental.com resolves to the landing page.
- [ ] Landing hero matches the homepage hook below.
- [ ] All consumer-facing strings say "Tournamental", not "SimulatedSports".
- [ ] Telegram bot identity is `@TournamentalBot` (or `@TournamentalTournamentBot` if the short name is taken). Avatar matches the brand.
- [ ] Disclosure copy appears on every page surfacing market data and on every affiliate link.
- [ ] Sign-in offers Telegram, email magic link, and passkey paths (per [doc 13](13-telegram-bot-and-auth.md)).
- [ ] No string in any UI uses "bet", "stake", or "wager" outside the third-party-disclosure label.

## Homepage hook (copy)

```
Predict the tournament.
Beat the market.
Prove it.

Tournamental is the live prediction game where fans lock in their calls,
compete on leaderboards, and build a verified record of their best
tournament predictions.

Make your picks. Watch the odds move. Score points for being early.
Prove you saw it before everyone else.

  [ Join the Tournament ]   [ Create a Private League ]   [ View Live Predictions ]
```
