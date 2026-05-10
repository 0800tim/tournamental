# 18 — Monetization

> Comprehensive revenue model for Tournamental. Affiliate routing as one lane (geo-restricted, capped by NZ regulation), but **the platform's design opens at least eight other revenue surfaces** that don't depend on a single sportsbook deal or a single jurisdiction. Strategy: keep the free-to-play game as the primary product so the business is not dependent on gambling access in any one country; monetize across many surfaces; treat affiliate as upside, not core.
>
> **Where the money actually goes:** all monetization revenue flows to **Tournamental Holdings** (and its companion entity **Tournamental Foundation**). The Foundation's published treasury policy then streams a fixed percentage to upstream contributors via Drips Network. Full structure and contributor revshare mechanics in [doc 19](19-open-source-and-contributor-revenue.md).

## TL;DR — the six revenue lanes ranked

For Tournamental specifically (NZ home base, free-to-play core, Prediction IQ as the killer feature), the priority order is:

| # | Lane | Regulatory load | Revenue ceiling | Time-to-first-dollar |
|---|------|-----------------|-----------------|----------------------|
| 1 | **Sponsored tournaments + native ads** | Low | $0.5M–$10M per major tournament | Weeks |
| 2 | **Tournamental Pro subscription** | None | $5M–$50M ARR at scale | Days post-launch |
| 3 | **B2B white-label** | None | $10M+ ARR | 1–3 months |
| 4 | **Creator leagues** | Low | $1M–$10M | Weeks |
| 5 | **Affiliate routing (geo-restricted)** | High in some jurisdictions | $25M–$250M+ per major tournament where applicable | Months (deal cycle) |
| 6 | **Data licensing + Verified Pundit programme** | Low | $1M–$10M ARR | 6–12 months |

Lanes 1–4 are the "ship-anywhere" base; lane 5 is the geographically-bounded upside; lane 6 is the long-term reputation-network monetization.

## The big NZ regulatory update

**From 28 June 2025, TAB NZ became the sole legal online race and sports betting provider for people located in New Zealand**, and New Zealanders are not lawfully allowed to place bets with anyone other than TAB NZ. This is a tighter constraint than the older Polymarket/Kalshi-flagged framing in [doc 15](15-tournamental-brand-and-positioning.md) and forces a hard rule:

- **NZ users see no offshore-sportsbook affiliate links. Ever.**
- The only legal NZ-facing affiliate option is TAB NZ — and only if TAB NZ runs an affiliate programme open to a free-to-play prediction game (verify in writing before shipping any link).
- Polymarket is *also* not legal for NZ users to use, so no Polymarket affiliate to NZ users either.
- Tournamental for NZ users is **free-to-play only**, with Tournamental Pro / sponsored badges / data offers as the monetization.
- This drives traffic to lanes 1–4 + 6 for the home market — which is fine because those lanes don't have a regulatory cliff anywhere.

A standard standing instruction for the affiliate routing engine: *if Cloudflare's `cf-ipcountry == "NZ"`, the only affiliate link surface is TAB NZ (if approved) or no link*.

## Lane 1 — Sponsored tournaments and native ad surfaces

The platform is built for this. Every prediction-game surface is a place a brand can tastefully put their name without breaking the UX.

### Sponsored named challenges

```
"Red Bull Comeback Challenge"     — points 2× for correct comeback predictions
"Nike Underdog Cup"               — separate leaderboard for <30%-implied calls
"TAB Free Prediction League"      — TAB-branded league (NZ-eligible)
"Heineken Match Day Predictor"    — branded daily prompt
"Pepsi Final Four Bracket"        — bracket challenge with sponsor logo + prize
```

Inventory shape per tournament: 2–6 named challenges, each with logo placement on the dedicated leaderboard, a custom badge artwork, and inclusion on share cards. Pricing: $50k–$1M per tournament per sponsor depending on tournament size and exclusivity.

### Sponsored badges (brand-issued bragging rights)

A brand can sponsor a permanent badge that lives on user profiles forever. Example: `"Vodafone Country Champion"` for the user who tops the country leaderboard during a tournament. The badge has the sponsor's logo on its artwork and lives in the user's profile gallery long after the campaign ends — which is *highly* valuable real estate.

Pricing: $10k–$200k per badge per tournament.

### Sponsored AI commentary voices

We're already using ElevenLabs (see [doc 6](06-video-ingest.md), [doc 14](14-clip-generation-and-social.md)). A licensed celebrity commentator voice — or a brand-native voice ("Snickers presents the in-app commentary by ___") — drops into the same pipeline. Premium tier; users hear it on rendered match playback and on auto-generated clips.

Pricing: $50k–$500k per voice per tournament.

### Sponsored stadium skins in the renderer

The renderer's stadium is a swappable asset. A brand can sponsor a skin: a Pepsi-branded crowd ring, an Etihad pitch-side ad mesh, a Coca-Cola scoreboard. Doesn't change physics or gameplay — pure cosmetic.

Pricing: $25k–$250k per skin per tournament.

### Sponsored live prediction prompts

Comeback Radar (mode 9 in [doc 16](16-game-modes-and-scoring.md)) issues live prediction prompts. These prompts can carry a sponsor:

```
[Brought to you by Heineken]
Will the next goal be in the next 10 minutes?
```

Lightweight, contextual, brand-safe. Pricing: $5k–$50k per tournament per prompt slot.

### Sponsored streak rewards (local activation)

A 10-streak "Hot Hand" earns the user a bonus from a local sponsor: free coffee from a local cafe, a discount code from a local retailer, a beer at a local pub. Geographically targeted via the user's `country` + `city_geohash5` (already in the profile). Sponsor pays per redemption; redemption rate is naturally high because earning the streak is the gating action.

Pricing: $5–$25 per redemption to the platform; sponsor sets the prize cost.

### Sponsored push notification slots

The Tournament Bot ([doc 13](13-telegram-bot-and-auth.md)) sends push notifications. One non-essential notification per day can be a sponsor slot ("Heineken says: Argentina v France kicks off in 30 min — make your prediction"). Hard rule: never bundle a sponsor message with a prediction-resolution or streak-protection notification — those stay clean.

Pricing: ~$5–$20 CPM (per thousand subscribers seeing the message), tournament-scaled.

### Inventory stack at a major tournament (illustrative)

For a World Cup-scale event with Tournamental at meaningful scale (5M+ registered users):

| Inventory | Slots | Price each | Subtotal |
|-----------|-------|------------|----------|
| Sponsored named challenges | 4 | $200k | $800k |
| Sponsored badges | 3 | $50k | $150k |
| Sponsored commentary voices | 2 | $150k | $300k |
| Sponsored stadium skins | 2 | $100k | $200k |
| Sponsored live prompts | 6 | $25k | $150k |
| Sponsored push slots | tournament-long | tournament avg | $200k |
| **Tournament total** | | | **~$1.8M** |

That's a *single tournament* of native ad inventory. Annualizing across 4–6 major tournaments per year (FIFA WC, Euros, Rugby WC, Cricket WC, IPL, NBA Finals) gets you to the $5M–$15M range without ever showing a sportsbook link.

## Lane 2 — Tournamental Pro subscription

Recurring revenue, no regulatory load, scales linearly with engaged-user count.

### Tiers

**Free** (the platform — most users).
- All 10 game modes, all leaderboards, basic share cards, badges, basic VStamps.
- AI Match Briefing once per matchday (concise version).
- Free league hosting up to 50 members per league.

**Tournamental Pro — $9.99/month or $79/year.**
- Unlimited AI briefings + AI Prediction Coach + AI Post-Match Debrief per match.
- Advanced odds movement charts (multi-operator, historical).
- Prediction analytics: win rate by sport, by tournament stage, by implied-probability bucket; export.
- Custom alerts: "market moved >15%", "friend overtook you", "your locked prediction's odds shifted".
- Private leagues up to 1,000 members, custom branding, prize-tracking.
- Priority access to new sport modules and beta features.
- Premium Bitcoin-verified VStamp upgrade — every prediction immediately submitted to OpenTimestamps + Polygon (free tier batches every minute; Pro batches every 10 seconds).
- Custom profile URL: `tournamental.com/u/<custom>` instead of `tournamental.com/u/<user_id>`.

**Tournamental Pro for Coaches — $29.99/month.**
- Everything in Pro.
- Multi-account roster management (a coach managing 25 athletes' predictions for analysis).
- White-label "team challenges" with the coach's branding.
- Dedicated CSV/JSON export and API key for integrating with their own tools.
- Aimed at fantasy podcasters, sports academies, sports analysts, and small-team B2B.

### Realistic ARR model

Conservative Pro penetration is 1–3% of active users; aggressive is 5–10% (think Strava Premium / Patreon-style).

| Active users | Pro % | Pro subs | $9.99/mo ARR |
|--------------|-------|----------|--------------|
| 250k | 2% | 5,000 | $600k |
| 1M | 2% | 20,000 | $2.4M |
| 5M | 2% | 100,000 | $12M |
| 5M | 5% | 250,000 | $30M |
| 10M | 5% | 500,000 | $60M |

These numbers compound — Pro has high retention because the analytics get more useful the longer the user's history. Plus Pro for Coaches at higher LTV is a separate stream.

## Lane 3 — B2B white-label

The whole Tournamental stack — predictions game, leaderboards, badges, private leagues, share cards, optional renderer — wrapped as a white-label engine for organizations that want fan engagement without building it themselves.

### Customer segments

- **Sports clubs** — fan-engagement campaigns through the season.
- **Broadcasters** — interactive watch-along layer for digital streams.
- **Pubs / bars** — branded WC pool with leaderboards on TVs.
- **Fantasy / podcast brands** — community engagement with Verified Pundit upsell.
- **Discord servers** — engagement layer for sports communities.
- **Schools and universities** — internal tournaments (heavy discount tier).
- **Workplaces** — office sweepstakes with brand-managed prizes (HR engagement).
- **Media / publishing** — embedded "predict alongside the article" widget.

### Pricing structure

```
Setup fee:            $5k–$50k       (one-time, includes white-label theming + support)
Per-tournament fee:   $1k–$25k       (depends on audience size + custom branding)
Per-MAU fee:          $0.05–$0.50    (monthly active user fee, scaled to engagement)
Heavy discounts:      educational, non-profit, small clubs (often free for community goodwill)
```

A single mid-size broadcaster deal (say, a regional Sky Sports equivalent running an interactive World Cup layer) at $250k upfront + $0.20 per MAU × 500k MAU × 6 weeks = ~$1.6M for one deployment. Three or four such deals/year and you're at $5M–$10M ARR before any other lane.

### Watch Party Mode (B2B-flavored)

A dedicated screen mode for pubs, lounges, and Discord streams: live score, match clock, live market odds, Tournamental crowd prediction, biggest market moves, leaderboard movement, best live calls, "who just got wrecked", "who called the comeback". Sold as part of the white-label package, or as a stand-alone Pubs subscription at $49/month per location. Hardware: any modern smart TV with a browser does it.

## Lane 4 — Creator and community leagues

Influencers, streamers, sports clubs, and community leaders run their own private leagues for their audiences. They own the branding and — critically — *they own the monetization*. Tournamental provides the engine and **never touches their money**.

This is the most powerful and most defensible monetization path on the platform. It strengthens the "we are infrastructure, not a betting operator" positioning because the platform is genuinely community-led: every prediction game is somebody's league, run by them, for their people.

### How creators and community leaders monetize off-platform

Examples of the model in action — none of which involve Tournamental handling a single dollar of the operator's revenue:

- **Soccer YouTuber, 500k subscribers**, runs a free Tournamental league for their audience. Monetises via existing YouTube ad revenue boosted by the engagement, Patreon subscriptions for "pundit's picks" (delivered via the creator's own Patreon, never through Tournamental), branded merch, and direct sponsorships they sign with their own sponsors.
- **Rugby club leader** runs a small Tournamental league among the club's 200 members for the season. Off-platform, members pay $20 each to enter a club-organised raffle / sweepstake; the verified Tournamental leaderboard determines the winner; the pot funds the new clubrooms. Cash settlement happens member-to-treasurer through the club's existing bank account or Wise. Tournamental provides the verified leaderboard. We never see the money.
- **Twitch streamer** offers a "Pundit's Picks" Patreon tier; their backers see the streamer's locked predictions in real time during the stream. The tier is sold and fulfilled entirely through Patreon. The streamer's VStamp history is the proof their picks were locked before kickoff.
- **Sports bar / pub chain** runs a free seasonal Tournamental league across all its locations, branded with the chain's name. They monetise via increased foot traffic, food and drink sales, and a season-end prize ceremony at the flagship venue. The chain's marketing budget pays for any prizes; Tournamental provides the league engine on a free or B2B-discounted tier.
- **Local news media** embeds a Tournamental league alongside its coverage of a tournament. Monetises via existing ad inventory + a sponsor of "<Sponsor>'s Tournament Predictor". League-engine cost runs through the B2B white-label tier in lane 3.

In each case Tournamental provides: the league mechanics, the verified leaderboard, VStamp prediction receipts, shareable cards the creator uses in their own content, and (optionally) the Tournament Bot in their group chats. Tournamental's take from the creator's external revenue: **zero**. We are explicitly not a custodian, not a payment processor, not a sportsbook, not a counterparty.

### Where Tournamental's revenue *does* come from in this model

Indirectly, not from the creator's wallet:

- Affiliate-link clicks within the league (subject to lane 5 geo-rules — the creator never sees this revenue).
- Tournamental Pro upsells to engaged creator-league members (lane 2).
- Sponsored ad inventory (lane 1) seen by the creator's audience.
- B2B white-label tier (lane 3) for larger creators or organisations who want custom branding, larger member caps, or admin tools.

If a creator wants to monetise *through* the platform rather than around it (creator charges audience for premium league access, Tournamental handles billing), that's the optional secondary path — and we take a 15% cut for handling Stripe and the entitlement plumbing. Most creators with their own audience won't need this and will keep monetisation on their existing channels. That's fine. We benefit from their growth either way.

### Optional secondary path: creator monetises *through* Tournamental

For creators who don't have their own subscription pipe set up, Tournamental offers an opt-in:

```
Free creator league:      Creator runs the league. Tournamental keeps any incidental
                          affiliate revenue from market-link clicks (subject to
                          geo-rules). Creator pays nothing, earns nothing on this
                          path; their monetization is wherever they run it.

Premium creator league:   Creator charges their audience for league access (e.g.
                          $5/mo) via Tournamental's optional billing pipe. Tournamental takes
                          15% of subscription revenue. Stripe fees pass through.
                          Use this only if the creator doesn't already have their
                          own paid-tier infrastructure.

Sponsored creator league: Creator brings a sponsor; revenue split 50/50 between
                          creator and Tournamental after the sponsor's fee.
```

Creator-economy ceiling estimate (illustrative, see disclaimer below): a mid-tier sports streamer with 50k engaged followers running a premium creator league at 5% paid conversion at $5/mo = 2,500 paying members × $5 × 12 = $150k/year, of which Tournamental earns $22.5k via the optional billing path. Three hundred such creators on the optional billing path = $6.75M/year of platform revenue, with Tournamental doing zero customer acquisition. The flywheel: Tournamental's Verified Pundit programme (lane 6 below) gives creators a verifiable track record to point at when they pitch their league.

### Why this is the right model

A creator running a league funded by their YouTube ads is **infrastructure usage**, not a betting affiliate funnel. A rugby club running a $20 sweepstake for new clubrooms is **community fundraising**, not Tournamental operating a lottery. By making this the headline monetization story for community-led activity — and making it explicit that Tournamental never touches the money in any of these flows — the platform's regulatory surface stays small, the trust story stays clean, and the creators get a clean engine to build on without inheriting any of Tournamental's compliance overhead.

## Lane 5 — Affiliate routing (the high-ceiling, geo-restricted lane)

Synthesizing the ChatGPT analysis: the absolute *upper bound* on affiliate revenue (1M qualified funded depositors at premium CPA) reaches $200M+, but realistic scenarios for Tournamental during a single tournament are an order of magnitude smaller. **Build for the realistic scenario; design for the upper-bound to be possible.**

### The four affiliate models

**1. Polymarket-style first-deposit referral.** $0.01/click + $10/first-deposit per Polymarket's public terms. Simple attribution. Works in jurisdictions where Polymarket itself is legal (not NZ, not US except some narrow contexts, available in many EU and global markets).

**2. Sportsbook CPA.** $50–$250 per qualifying depositor. Fixed payment per FTD meeting the operator's terms. Best for short-burst tournament traffic where retention isn't proven yet.

**3. Sportsbook revenue share.** 25–55% of operator net gaming revenue from referred users. Good only if users are expected to keep betting long-term. Heavy welcome-bonus periods can drag NGR negative for the first weeks of a campaign.

**4. Hybrid (CPA + smaller revshare).** $50 CPA + 15–20% revshare. Recommended for Tournamental because it captures upfront cash *and* compounds if users stay engaged.

### Revenue scenarios (re-modelled with realistic ramp)

The ChatGPT brainstorm modelled an aspirational 1M-FTD scenario. Here's the more honest ramp expectation across three years:

| Year | Registered users | Funded-depositor conversion | FTDs in legal geos | Hybrid revenue ($50 CPA + 15% revshare on 6-week tournament) |
|------|------------------|------------------------------|-----|---|
| Y1 (first WC) | 500k | 1% | 5,000 | ~$0.5M–$1.25M |
| Y2 (mid year, smaller tournaments) | 1.5M | 2% | 30,000 | ~$3M–$7.5M |
| Y3 (Euros + return major year) | 5M | 4% | 200,000 | ~$20M–$50M |
| Y4 (global breakout) | 15M | 5% | 750,000 | ~$75M–$200M |

Year 1 is small because conversion takes time and reputation. The bigger numbers materialize when (a) legal geos open up via signed deals, and (b) Verified Pundit reputation creates word-of-mouth.

For comparison: a World Cup peak audience is ~1.5B viewers globally across all platforms. If Tournamental captures 1% of that (15M users) and converts 5% to FTDs in legal geos, that's 750k FTDs. That's roughly the year-4 ceiling — meaningful, but not hand-waved.

### Affiliate routing engine (the system Tournamental must actually build)

This is the component that turns affiliate revenue from "lottery ticket" into "consistent line item". It's a small TS service (`apps/affiliate-router/`) that decides, for every outbound market-link click:

1. **Geo-detect** the user (Cloudflare provides `cf-ipcountry` for free).
2. **Age-gate** — confirm the user is 18+ via the auth profile (declared at signup; legal in most jurisdictions but cross-check per region).
3. **Look up legal operators in this region** from a maintained `operators.yaml`:
   ```yaml
   bet365:
     legal_in: [GB, IE, AU, CA, DE, ES, IT, ...]
     legal_out: [NZ, US, ...]
     program_url: https://affiliates.bet365partners.com/...
     deal_type: hybrid
     cpa: 100
     revshare: 0.20
     epc_observed: 1.85
   tab_nz:
     legal_in: [NZ]
     program_url: https://affiliates.tab.co.nz/...
     deal_type: cpa
     cpa: 75
     epc_observed: 0.60
   polymarket:
     legal_in: [most-of-world-minus-NZ-AU-US-...]
     legal_out: [NZ, AU, US, ...]
     deal_type: first_deposit_flat
     cpa: 10
     epc_observed: 0.45
   stake:
     legal_in: [crypto-friendly-jurisdictions]
     ...
   ```
4. **Filter** to operators legal for this user *and* with active Tournamental affiliate deals.
5. **Rank** the surviving operators by current EPC (earnings per click), updated daily from our own tracking. Optionally weight by user-stated preference (some users want crypto-only options).
6. **Show the top 1–3** with clear "Opens a third-party site" labelling, bonus offer summary, and our tracking parameters in the URL.
7. **Track every click and downstream conversion** in our own clicks/conversions tables (Redis hot, S3 archive). Don't trust each operator's dashboard.
8. **Optimize routing daily** based on observed EPC, conversion rate, KYC pass rate, and revenue payback.
9. **Failsafe**: if no operators are legal for this user, hide the affiliate UI entirely. Never default-route to "the closest jurisdiction".

This is a bounded, well-scoped agent task — a candidate for **Agent N** (see [doc 09](09-agent-task-breakdown.md) update below).

### Custom deal structures to negotiate

For tournament-scale traffic, don't accept public affiliate terms. Negotiate:

- **Custom CPA tiers** (escalating per FTD bracket — 0–10k FTDs at $75, 10k–50k at $100, 50k+ at $125).
- **Hybrid upside** (CPA + 12-month revshare).
- **Exclusive tournament sponsor package** ($500k–$5M fixed plus CPA/revshare; gives the operator branded inventory in lane 1).
- **Region exclusivity** ("Official Tournamental betting partner for Brazil").
- **Performance floors** (guaranteed minimum if we give premium placement).

A combined deal with a single major operator at the top of a tournament can be $1M–$10M just on the fixed component, before per-FTD payouts.

## Lane 6 — Data licensing and the Verified Pundit programme

The platform produces two kinds of data that have outside-Tournamental value:

### Crowd-prediction data

The aggregate Tournamental crowd implied-probability over time is a unique dataset — effectively a real-time sentiment signal for sports outcomes. Comparable to Twitter sentiment but more structured (predictions are forced into outcome categories with locks).

Customers:
- **Media outlets** running data-driven sports columns ("the crowd thought X, the market thought Y, here's who was right").
- **Quant trading shops** sniffing for sentiment alpha.
- **Academic researchers** studying market efficiency / wisdom-of-crowds.
- **Sportsbook risk teams** for cross-validation against their own data.

Pricing: $10k–$100k/year per licensee for an API feed of aggregated, anonymized crowd predictions per match. No personal data; just the medians and distributions.

### Verified Pundit programme

The killer feature of [doc 17](17-vstamp-and-prediction-iq.md) — Prediction IQ + verifiable history — becomes a paid certification programme.

How it works:
- A user with a sustained Prediction IQ above a threshold (e.g. 1500, ~top 7%) becomes eligible for **Verified Pundit** status.
- Verification is free (it's already proven by their VStamps), but **monetization** kicks in via:
  - **Featured placement** in the Tournamental discovery feed and in tournament-relevant content.
  - **A "Verified Pundit" widget** they can embed on their own blog, podcast site, or Substack — pulling their live IQ + best calls. Free, but drives traffic back to Tournamental.
  - **Paid endorsements** — brands pay the platform to feature a Verified Pundit's pre-tournament picks. Revenue split with the pundit (50/50).
  - **Verified Pundit subscription tier** — a fan can pay $5/month to follow a specific pundit's locked predictions in real time (delayed for free users, instant for subscribers). Tournamental takes 15%.

This is the **flywheel** that converts the reputation network from a curiosity into a real business: pundits compete for IQ → users follow pundits → fans pay to follow → brands sponsor pundits → more pundits compete. Comparable economics to OnlyFans but for sports prediction skill, with verification as the moat.

Realistic scale: 500 verified pundits with average 500 paying followers at $5/mo × 15% = $1,800/pundit/year × 500 = $900k. Plus brand endorsements layered on top. Achievable at year 3–4 once enough sample exists.

## Other revenue surfaces (smaller but additive)

- **Premium clip downloads** — $1.99 per high-res, watermark-free MP4 of "your call" (the user's own prediction win, rendered with their name). Vanity purchase but high margin.
- **Custom voice clones for commentary** — $19.99 one-time to have your own voice (uploaded sample) commentate on your own clip shares. Novelty premium.
- **Tournament Bot premium personas** — alternative bot voices/personas at $4.99 each; "Posh British Pundit", "Cynical American Sportscaster", "Anime Tournament Host". Skin-style monetization.
- **Sponsored verification batches** — a brand sponsors a specific minute's Merkle batch ("Verified by Polygon × Heineken"). Branding on the public proof page. $500–$5k per batch slot during major tournaments.
- **API access for third-party developers** — $99/month base tier for read-only access to the public match-stream + leaderboard + crowd-prediction APIs. $999/month for higher rate limits and historical data.
- **Tournament-specific virtual goods** — confidence chip skins, badge animations, profile frames. $0.99–$4.99 each.
- **Donate / tip a creator** — Patreon-style tipping inside creator leagues. 10% platform fee.
- **Picks-of-the-week newsletter sponsorship** — sponsored email to all opted-in users. $1k–$10k per send depending on list size.

## Risk and compliance

For each lane, the regulatory load varies. Honest mapping:

| Lane | Risk surface | Required mitigations |
|------|--------------|----------------------|
| Sponsored tournaments + native ads | Low. ASA / FTC ad-disclosure rules. | Clear `Sponsored` labels. Don't blur sponsor and editorial copy. |
| Tournamental Pro subscription | Low. Standard SaaS. | Stripe / Paddle handles tax + chargebacks. |
| B2B white-label | Low. Standard B2B. | Per-customer DPA where required (GDPR, CCPA). |
| Creator leagues | Low if no cash prizes; medium if real-money entry. | Use the existing non-custodial sweepstakes pattern from [doc 12](12-odds-and-predictions.md). |
| Affiliate routing | High in some jurisdictions. NZ TAB monopoly, UK Gambling Commission rules, etc. | Geo-routing engine with hard fallback. Operator-by-operator approval. Age-gating. Responsible-gambling messaging. Affiliate disclosures on every link. |
| Data licensing | Low. | Aggregate / anonymize. No personal data in any feed. |
| Verified Pundit programme | Low for the reputation; medium when paid endorsements involve operators. | Endorsements that point to sportsbook offers go through the same affiliate routing engine + geo-rules. |

On payment processors: Tournamental doesn't custody money for sweepstakes (already specced — pools are non-custodial). All on-platform money flows are subscription (Stripe / Paddle) and B2B invoicing (Stripe Connect or direct ACH/wire). Affiliate revenue arrives from operators on net-30 / net-60 cycles; cashflow needs ~3 months runway to cover the lag during a big tournament campaign.

On responsible-gambling messaging: every page that surfaces market data displays the standard "Tournamental is a free-to-play prediction game…" disclosure. Every affiliate link includes the operator's responsible-gambling badge per the operator's affiliate brand-safety package. Some jurisdictions (UK in particular) require specific phrasing — handled per-region by the affiliate router.

## Why this stack is durable

Tournamental's revenue is *resilient* because it doesn't depend on any single lane:

- A regulatory crackdown on offshore sportsbooks in a major market closes lane 5 for that geo, but lanes 1–4 + 6 keep running.
- An economic downturn hits Tournamental Pro (lane 2) but probably increases free-to-play engagement, which lifts lanes 1 and 5.
- A sponsor pulling out of a tournament hits lane 1 but doesn't touch lane 2's recurring base.
- A creator competitor emerging hurts lane 4 but only at the margin.
- A blow to the platform's reputation (lane 6) is the *only* existential risk — which is why the verification layer ([doc 17](17-vstamp-and-prediction-iq.md)) is load-bearing for the whole business, not just a feature.

This is also why sponsored tournaments + Pro subscription lead the priority list: they're the lanes that ship without legal review and produce real revenue while the affiliate deals are still being negotiated.

## Build sequencing (what ships first, in what order)

This is the order of monetization features the agents (J / K / L / M / N) should ship, in addition to the core platform work in [doc 09](09-agent-task-breakdown.md):

1. **Affiliate click tracking infrastructure** (per-click DB rows + S3 archive). Must exist on day one even before any deals are signed; without it, no future revenue can be attributed.
2. **Tournamental Pro paywall** (Stripe + entitlement system in user record). Ships with first launch. The features it gates can come online progressively.
3. **Sponsored badge and challenge slot system** (config-driven; ops can drop a sponsor in via JSON + asset upload). Built once; reused every tournament.
4. **Affiliate routing engine** (geo + legality + EPC ranking). Built before the first major-tournament campaign.
5. **B2B white-label theming** (config-driven branding swap on the renderer + UI). Ships when the first customer signs.
6. **Creator league monetization** (subscription tiering inside private leagues). Ships month 6+ once Pro subscription billing is proven.
7. **Verified Pundit programme** (gated by Prediction IQ threshold; feature-flagged). Ships year 2+ once the population has enough verified history.
8. **Data licensing API** (aggregated, anonymized feeds). Ships when first inbound interest from a media customer; no point building before demand.

## Headline number expectations

> **These are illustrative scenarios, not forecasts.** The ranges below stack the six lanes under explicit assumptions: registered-user counts at each stage, conversion rates to Tournamental Pro, B2B deal counts, sponsor-deal sizes, and legal-geo footprint for affiliate. Actual outcomes depend on launch traction, regulatory developments per jurisdiction, sponsor-deal negotiations, and operator approvals — most of which are unknowable until they happen. These numbers are appropriate for internal planning and high-level partner conversations; they should not be presented to investors, regulators, or sophisticated counterparties as forecasts. Tournamental does not custody user funds, does not operate as a sportsbook, and these figures are not a solicitation of investment.

Stacking the lanes at three points in the company's life:

**Year 1 (first major tournament, 500k registered).**
- Sponsorship: $0.5M–$2M (one tournament, 1–2 sponsors landed)
- Tournamental Pro: $0.3M (5k subs at $9.99)
- B2B: $0–$0.5M (early deals)
- Affiliate: $0.5M–$1.5M (small geo footprint)
- Total: **~$1M–$4M**

**Year 3 (5M registered, established brand).**
- Sponsorship: $5M–$15M (across 4–6 tournaments, multiple sponsors each)
- Tournamental Pro: $12M–$30M (100k–250k subs)
- B2B: $5M–$15M (3–10 white-label deals)
- Creator leagues: $1M–$3M
- Affiliate: $20M–$50M (legal-geo footprint expanded)
- Verified Pundit + data: $1M–$3M
- Total: **~$45M–$120M**

**Year 5 (15M+ registered, multi-tournament-of-record platform).**
- Sponsorship: $20M–$50M
- Tournamental Pro: $40M–$100M
- B2B: $20M–$50M
- Creator: $5M–$15M
- Affiliate: $75M–$200M (peak tournament window)
- Verified Pundit + data: $5M–$15M
- Total: **~$165M–$430M**

The headline insight: **affiliate is large but never the majority** in a healthy Tournamental. By year 5, sponsorship + Pro + B2B is half the revenue, and that half is regulatorily robust globally. Affiliate is the upside that compounds in legal geos; it's not the foundation.

## Acceptance criteria for the monetization layer

- [ ] Click tracking writes every outbound market-link click to durable storage with `(user_id, operator, region, timestamp, deal_id)`.
- [ ] Affiliate router never shows a sportsbook link to a NZ-located user.
- [ ] Affiliate router never shows a Polymarket link to a NZ-located user.
- [ ] Tournamental Pro entitlement is a single boolean on the user record; gated features check it server-side, not client-side.
- [ ] Sponsored challenge / badge / voice / stadium configs are JSON-driven; adding a sponsor is a config change, not a code deploy.
- [ ] B2B white-label theming swaps logo, colour palette, and brand strings via env config + assets, not by forking the codebase.
- [ ] Disclosure text (`Sponsored`, `Opens a third-party site`, `Tournamental is a free-to-play prediction game`) is injected by the layout, never written by hand into individual pages.
- [ ] Cashflow forecast assumes a 60-day lag on affiliate payouts and a 30-day lag on B2B contract revenue.

## Sources cited in this doc

- [Polymarket affiliate / referral program (public terms)](https://polymarket.com/affiliate)
- [TAB NZ — sole legal NZ online sports betting provider, effective 28 June 2025](https://www.dia.govt.nz/Gambling-licensing-online-sports-betting)
- [UK Gambling Commission — affiliate responsibilities](https://www.gamblingcommission.gov.uk/guidance/the-licensing-conditions-and-codes-of-practice/affiliates)
- [iGaming affiliate model overview (CPA / revshare / hybrid)](https://www.affiliateguard.com/igaming-cpa-vs-revshare/)
- [Sportsbook hold benchmarks — typical 5-9% range](https://www.legalsportsreport.com/sports-betting-revenue/)
- [Entain partner programme — 24-month revshare cap](https://www.entainpartners.com/)
