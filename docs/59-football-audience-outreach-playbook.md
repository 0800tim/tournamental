# Football-Audience Outreach Playbook

> **Goal**: get Tournamental in front of football/soccer fans by partnering with the people who already have their attention, YouTube creators, club community teams, fan media, prediction-adjacent companies. Designed to be executed by one person (Tim) over a multi-week run-up to the 2026 World Cup, not a single 48-hour blitz.

This is the football-audience complement to `LAUNCH-PLAYBOOK.md`, which targets AI-builder press and AI YouTubers. The two playbooks share zero contacts and use deliberately different voices. Do not mix them. An AI-builder pitch sent to a football channel reads as off-brand; a "we open-sourced our edge" pitch sent to a club's community manager reads as confusing.

## 0. The pitch, in one sentence per audience

Before reading anything below, internalise that the pitch changes by audience. Same product, different framing.

| Audience | One-sentence pitch |
| --- | --- |
| Football YouTubers / podcasters | "Free embeddable World Cup 2026 bracket your viewers can fill in, branded as your channel's pool, with prizes if you want to put a fee on it." |
| Club / federation community team | "A white-label prediction pool for your fan community, with your colours, logo, and sponsor placement, free for the club, you keep all entry fees." |
| Fan media (Goal, Athletic, OneFootball, etc.) | "Embed our prediction widget on your WC 2026 hub. We supply the engine and a per-publisher leaderboard; you keep the readers and the ad inventory." |
| Fantasy/stats companies (FotMob, Sofascore, FPL content) | "We've open-sourced the bracket-game layer your users already want. Bundle it into your app via our embed, white-labelled, and we'll cite you as the official data partner." |
| Sportsbooks / odds publishers | "A free-to-play funnel into your paid product. The bracket is open source so there's no platform risk. Affiliate code splits 70/30 in your favour." |
| Reddit / Discord football communities | "Built a free WC 2026 bracket for our subreddit. Here's our community's leaderboard link, top three at the end of the group stage get a [prize]." |

If you cannot remember which framing belongs to which audience, you will accidentally send a developer pitch to a Premier League club's community manager and they will mark you as spam. Re-read this table before every outreach session.

## 1. Football YouTube creators

The single biggest leverage channel for a prediction product. A 250k-subscriber football YouTuber asking their viewers to join "Tom's WC2026 Pool" delivers 5,000+ verified picks in 48 hours, repeatedly, throughout the tournament.

### 1a. How to source the list

The discovery tool at `tools/youtube-discovery/` produces a ranked Google Sheet with subscriber count, engagement, last-upload recency, primary language, and (where available) a contact email. Run it once before each outreach wave.

```bash
cd tools/youtube-discovery
python discover.py --min-subscribers 25000 --max-results 200 --email-extract-top 100
```

A full run hits the YouTube Data API for ~250 quota units (out of a 10k/day free quota), takes ~6 minutes total, and writes to Drive at `Tournamental GTM / YouTube Outreach / Channels - YYYY-MM-DD`.

If the tool surfaces a channel that's already in the manual tier list below, use the manual entry's contact info, hand-curated contacts outperform scraped ones.

### 1b. Tier 1 manual list (top 20, send first, personalised)

These are the high-leverage targets. Each gets a hand-written email, not a templated one. Spend 15 minutes per email. Twenty emails is five hours of work; the rest of this section is mass-sendable.

| Channel | Why this one first | Contact route |
| --- | --- | --- |
| **Tifo Football** | Tactical-analysis audience that already fills in brackets every tournament | `hello@tifofootball.com` or DM @TifoFootball_ |
| **Statman Dave** | Stats-curious audience; bracket games are native to them | DM @StatmanDave on X, then `dave@statmandave.com` |
| **WhatCulture Football** | Pop football, weekly group-stage podcasts | `info@whatculture.com` |
| **AwayDays / The Athletic football desk** | "Predictions across the desk" features each WC, our widget slots in | Athletic editorial intake, see §3 |
| **The United Stand (Mark Goldbridge)** | Massive engagement; lives for fan-vote content | `info@theunitedstand.com` |
| **Footballerz / Spencer FC** | Built-in audience for fan-competition formats | Spencer's agent, in description |
| **Fútbol Americas (ESPN Deportes)** | LatAm reach; WC is religion in their audience | ESPN press desk |
| **DeJong's Bistro / Soccerlogical** | Tactics + predictions in English from a Dutch fanbase | DMs only |
| **Brazilian Soccer Talk** | English-language Brazil coverage, underrated reach | DM + email in description |
| **Comunio / 433** | 30M+ Instagram audience overlap with their YT; embed potential | `business@433.com` |
| **OneFootball (English channel)** | Already runs prediction content, our widget is a content product for them | `partnerships@onefootball.com` |
| **Squawka / Squawka Football** | Stats-heavy, weekly predictions show | `info@squawka.com` |
| **GOAL (English channel)** | See §3, but the YT side has separate editorial | `social@goal.com` |
| **Tactalyse / The Football Termite** | Niche but extremely engaged; perfect for a "Termite Pool" branded embed | DM only |
| **HITC Sevens** | Listicle-heavy; a "fan picks vs editor picks" article is a layup | `info@hitc.com` |
| **The Athletic FC (YouTube)** | If you can get the embed into a daily WC2026 segment, you've won | See §3 |
| **Total CFC / AFTV / etc.** (club-fan channels) | One per major club; the "Arsenal Fans' Bracket" framing is a wedge | Per channel; see §1c |
| **Caught Offside / 90min** | High-volume publisher with YouTube arm; bracket is feature content | `editors@caughtoffside.com` |
| **MLS Insider / CONCACAF channels** | Co-host nation coverage means WC2026 is their year | League press desks |
| **Copa90** | Built for fan-storytelling; the open-source angle resonates here too | `hello@copa90.com` |

### 1c. Club-fan channels (one per major Premier League / La Liga / Serie A side)

Every big club has 2-5 fan-run YouTube channels with 200k-2M subscribers. The pitch is identical: "Free branded prediction pool for your viewers; you keep all entry fees if you choose to charge one." Channels currently worth approaching:

- **Arsenal**: AFTV, Le Grove, Arsenal Vision
- **Manchester United**: The United Stand, Stretford Paddock, Full Time DEVILS
- **Liverpool**: Redmen TV, The Anfield Wrap, LFC Stories
- **Chelsea**: Talk Chelsea, Chelsea Fan TV
- **Manchester City**: Blue Moon, Esteemed Kompany
- **Spurs**: SpursPlay, The Fighting Cock
- **Real Madrid / Barcelona**: Madridista TV, Barça Universal, Football España
- **Bayern**: Bayern Insider (EN), Miasanrot
- **PSG**: PSG Talk, Paris Family
- **Boca / River / Flamengo / Palmeiras**: see the Spanish + Portuguese tabs of the discovery tool output

Per-club channels are best contacted via Twitter/X DM first (they all live there). Email exists but goes unread. Lead the DM with "love your show, would your viewers want a free [Club Name] WC2026 prediction pool", attach a screenshot of a mocked-up branded pool. Mock-up takes 2 minutes via the manage UI.

### 1d. Outreach template (Tier 2 mass send, post-Tier-1)

Use this for the discovery-tool output rows 21 through 200. Personalise the first line only; the rest is templated.

> Subject: *Free WC2026 prediction pool, branded as [Channel Name]*
>
> Hi [first name],
>
> I watched [most recent video title] this week, the bit about [specific moment] was the kind of thing that makes your channel land for me.
>
> I'm Tim, the founder of Tournamental. We're a free-to-play prediction-bracket platform for the 2026 World Cup. The thing I wanted to put in front of you specifically is that we let creators run their own branded "pool", your logo, your colours, your channel name in the URL, your viewers picking through the whole tournament.
>
> What you get:
>
> - A shareable link your viewers can join in 10 seconds (Telegram, WhatsApp, or email auth)
> - A leaderboard branded as your channel
> - An optional entry fee (you keep 100%, we take nothing)
> - An embed widget you can drop on your channel page or community tab
> - We open-sourced the whole stack (Apache 2.0), so there's no lock-in
>
> What it costs you: zero. We make money from the platform-wide pool, not from creator pools.
>
> If this is something you'd consider running for WC2026, hit reply and I'll set up a [Channel Name] pool tonight, you'll get an admin link and a 60-second loom showing how to share it.
>
> Tim Thomas
> Tournamental, https://play.tournamental.com
> +64 21 535 832

**Sending mechanics**: send 25-50 of these per outreach session, BCC yourself, track replies in the same Google Sheet the discovery tool produced (add a `status` column manually). One follow-up after 5 working days if no reply, single sentence: *"Just bumping this in case it got buried, no worries if not a fit, the offer stays open for the tournament."* Then drop it.

**Do not send three follow-ups. Do not LinkedIn-connect. Do not DM them after they ignored the email.** Football creators get pitched constantly; one polite follow-up reads as professional, two reads as desperate, three gets you blocked.

## 2. Football clubs and federations

### 2a. Why this works

A club's community team is judged on engagement metrics (DAU on the app, social engagement rate, newsletter open rate). A free, branded prediction pool *bumps every one of those metrics* without costing the club anything. It is one of the easiest "yes" calls in football marketing, *if* you reach the right person.

### 2b. Wrong contact, right contact

| Don't email | Do email |
| --- | --- |
| General `info@` or `contact@` (goes to a CRM black hole) | The named community / digital / fan-engagement manager |
| Commercial / sponsorship (will ask for a six-figure rights fee) | Digital marketing, fan engagement, or community lead |
| Press office (will route it to commercial, see above) | Senior content producer for the club's own media channels |

### 2c. How to find the right person

LinkedIn search, filter by company = "[Club Name] Football Club", title containing "community" OR "fan engagement" OR "digital content" OR "social media manager" OR "head of content". Most clubs have 2-4 such people; mid-level (3-7 years experience) titles convert at the highest rate. Do not pitch C-level, they will defer to the same mid-level person but with two weeks of latency.

Email format is almost always `firstname.lastname@<clubdomain>` or `flastname@<clubdomain>`. Verify with [Hunter.io](https://hunter.io) (free tier covers ~50 lookups/month, enough for two clubs per day for a month).

For federations (FA, USSF, CBF, FFF, RFEF, AFA, DFB): the relevant contact is "Head of Digital" or "Head of Fan Engagement". Same LinkedIn pattern.

### 2d. Club outreach template

> Subject: *Free branded prediction pool for [Club] fans, World Cup 2026*
>
> Hi [first name],
>
> I'm Tim Thomas, founder of Tournamental. I wanted to share something that I think [Club]'s digital team will get immediate value from for WC2026.
>
> We're a free, open-source prediction-bracket platform built for the 2026 World Cup. Clubs can run a white-labelled "pool" for their own fans, no rights fees, no integration work, just a branded URL we set up in 5 minutes. Your colours, your crest, your sponsors if you want them.
>
> Concretely, [Club] would get:
>
> - A `pools.tournamental.com/[club-slug]` page branded entirely as [Club] (or your own subdomain if preferred, we'll set up the CNAME)
> - Embed widget for your match-centre / fan-zone page on [club-domain]
> - A leaderboard scoped to [Club] fans only, with shareable end-of-stage cards your team can post
> - All data we collect on [Club] fans is yours, GDPR/CCPA exportable on request
> - Optional sponsor placement (we'll integrate any one of your existing sponsors at no cost)
>
> Cost to [Club]: zero. The platform is funded by a separate global pool that doesn't affect your branded one.
>
> Open to a 15-minute call this week or next? Happy to send a 90-second walkthrough video instead if your inbox is the realistic place to get this decided.
>
> Tim
> +64 21 535 832
> [LinkedIn profile URL]
> https://play.tournamental.com

**Follow-up**: same pattern as YouTube, one polite bump at five working days, then stop. Clubs move slowly; if the initial reply is "interesting, send more info", reply within four hours with a 60-second Loom video, a one-page PDF, and three live example pools.

### 2e. Which clubs to prioritise

Match the tournament narrative. In the run-up to WC2026:

1. **Host-nation league sides first**: MLS, Liga MX, Canadian Premier League. The tournament is theirs to talk about.
2. **National federations of obvious favourites**: France, Argentina, Brazil, England, Spain, Germany, Portugal. These have the biggest fan bases checking national-team content monthly.
3. **English Premier League fan-engagement teams**: they're the most professionalised digital teams in football and set the standard the rest follow. Crack one and the rest get easier.
4. **Underdog-nation fan associations**: Morocco, Croatia, Senegal, Japan, Australia, NZ Football. Smaller teams but high engagement rates and lower competition from other partnership pitches.

Run no more than 5 club emails per day so each can be properly personalised.

## 3. Football media and publishers

These are higher-prestige, harder to crack, longer sales cycle (4-8 weeks), but a single yes is the equivalent of fifty YouTube partnerships in audience reach.

| Outlet | Why a yes here is platform-level | Contact route |
| --- | --- | --- |
| **The Athletic FC (NYT)** | Their bracket coverage owns the smart-fan segment; embedded widget on every WC2026 article = millions of MAU | `editorial@theathletic.com`, attn: head of football product |
| **Goal.com** | Largest dedicated football site by traffic; bracket is native content | `social@goal.com`, escalate to head of partnerships |
| **OneFootball** | App-first, prediction games already in product roadmap | `partnerships@onefootball.com` |
| **ESPN FC** | US co-host advantage, WC2026 is their biggest property | ESPN press desk via [espnpressroom.com](https://espnpressroom.com) |
| **BBC Sport** | Public-broadcaster reach in UK; complicated by commercial restrictions but worth trying | `sport.contacts@bbc.co.uk` |
| **Sky Sports / NBC Sports / DAZN** | TV-rights holders; pitch as a free second-screen engagement tool | Each has a digital-product team; LinkedIn route |
| **Bleacher Report** | Engagement-first, native to bracket content | `partnerships@bleacherreport.com` |
| **Marca / AS / L'Équipe / Bild / Gazzetta** | Largest football titles in Spain, France, Germany, Italy; one wins the language market | Each has a digital partnerships email on their press page |
| **CONMEBOL / CONCACAF / AFC / CAF / OFC official channels** | Continental confederations, hard to reach but huge if you do | Via federation contacts in §2 |

Approach: media outlets do not respond to cold pitches the way creators do. They respond to *signal*. Build the signal first:

1. Get five Tier 1 YouTubers running pools (see §1).
2. Get one Premier League club running a pool (see §2).
3. *Then* pitch the publisher, leading with "we power prediction pools for [Club], [Channel A], [Channel B]". This is "social proof" not "vapourware".
4. The publisher's product team will say yes faster than their commercial team. Lead with product, not commercial.

### Publisher pitch template

> Subject: *[Outlet] WC2026 prediction widget, free embed, three Premier League clubs already on*
>
> Hi [name],
>
> I'm Tim Thomas, founder of Tournamental, the open-source prediction-bracket platform now running pools for [Club A], [Club B], [Channel C], and [Channel D]. I think there's a clean fit for [Outlet]'s WC2026 coverage.
>
> The product is a free embeddable bracket your readers fill in, with a per-outlet leaderboard. You get a content widget for every WC2026 article, a recurring "leaderboard update" you can run as editorial, and a first-party data stream of which readers are most engaged with WC2026 content. All open source, no lock-in, no cost.
>
> Closest analogue: the way ESPN Fantasy embeds into espn.com articles, but for prediction brackets, free, and you keep the brand.
>
> Would a 20-minute call with your digital product team make sense? I can be flexible to whoever owns engagement features.
>
> Tim
> [LinkedIn]
> Live examples: [3-5 pool URLs]
> Repo: https://github.com/0800tim/tournamental

## 4. Stats and fantasy-adjacent companies

These are the highest-conversion B2B partnerships because their existing users are *exactly* the people who fill in brackets.

| Company | Pitch angle | Contact route |
| --- | --- | --- |
| **FotMob** | "Bracket widget in your WC2026 hub, branded as FotMob, you keep the users" | `partnerships@fotmob.com` |
| **Sofascore** | Same as above | `business@sofascore.com` |
| **Opta / Stats Perform** | "Use our bracket as a content product for your media-partner clients" | Account managers, LinkedIn |
| **Fantasy Premier League Scout (FPL)** | Pre-/post-FPL-season audience, perfect WC2026 fit | `contact@fantasyfootballscout.co.uk` |
| **FPL Family / FPL Hints / Always Cheating** | FPL podcasts/YouTube, same audience | Per channel |
| **Comeon Sports / Forebet / SoccerSTATS.com** | Existing predictions audience, partnership = free traffic for them | Site contact forms |
| **FlashScore / 365Scores** | App-first, WC2026 hub already planned | `business@flashscore.com` |

For these: the call to action in the pitch is **"give us 20 minutes; if it's not a layup we'll go away"**. Stats companies respect product confidence.

## 5. Sportsbooks and odds publishers

Counterintuitively, these are *partners*, not competitors. Tournamental is free-to-play and not a sportsbook; we are a *funnel* into their paid product.

Pitch: "Your top sportsbook prospect for WC2026 is a casual fan who's currently *not* on your platform. Our free bracket has 100k of them. We'll route them to your signup with an affiliate code. 70/30 in your favour."

Targets:

- **DraftKings** (US, big WC2026 spend) — affiliate desk
- **FanDuel** (US, same) — affiliate desk
- **bet365** (UK, global) — affiliate desk (slow but worth it)
- **Stake.com** (crypto-native, fits our on-chain story) — affiliate desk
- **Polymarket** (prediction-market native, sees us as upstream funnel) — Twitter DM or the integrations they already have a deal on (see `docs/29-polymarket-odds-integration.md`)
- **Smarkets / Betfair Exchange** (UK exchanges, niche but engaged) — affiliate desk
- **TAB NZ / Tabcorp AU / Centrebet** (home market, easier first wins) — affiliate desk

These conversations are commercial; budget a 4-8 week cycle and expect them to want a contract before promoting. Do *not* lead the website pitch with "we route to sportsbooks", it sours the prediction-product partners in §3 and §4. Keep the affiliate-router work backstage until it's needed; see `docs/18-monetization.md`.

## 6. Communities (Reddit, Discord, X)

This is where you seed *before* the paid/partnership channels and *during* the tournament for grass-fire growth.

### 6a. Reddit

- **r/soccer** (3.5M) — the main hub. Post one "we built a free bracket for /r/soccer's WC2026 pool, here's the leaderboard" thread on the day group-stage draws are announced. Post a follow-up after group stage ends. **Do not post more than twice.**
- **r/worldcup** — same approach, less competition for attention.
- **r/PremierLeague** (1.2M), **r/LaLiga** (300k), **r/Bundesliga**, **r/seriea**, **r/MLS**, **r/LigueUn** — one bracket pool per subreddit, with explicit mod sign-off first. Message the mod team before posting; they will either approve or kill it, and a post without sign-off gets deleted and bans you.
- **National-team subreddits**: r/usmnt, r/canadasoccer, r/AFCAsianCup, r/CONMEBOL, r/CAF — perfect for branded pools.
- **r/SoccerBetting** (200k) — be careful here, betting subs are aggressive. Frame as "free practice bracket" not "competitor to your bookie".

### 6b. Discord

- **Football Manager Discord servers** (sleeper hit, very engaged stat heads)
- **Per-club Discord servers** (every major club has 5-20k member servers run by their fan groups)
- **Prediction-market Discord servers** (Polymarket, Manifold, Kalshi)
- **CONCACAF / CONMEBOL fan Discord servers**

Discord approach: join, lurk for two weeks, contribute to non-promotional conversations, *then* drop a link with permission. Do not blast the moment you join. Mods will see it.

### 6c. X / Twitter

- Reply-guy strategy on high-engagement WC2026 tweets from established football accounts. Do not link the product in every reply; build recognition first.
- Sponsor one or two large Football Twitter accounts (e.g. @FabrizioRomano-tier impossible, but @TacticalManager, @StatmanDave, @SkySportsPL writers, accessible). Sponsorship rates for football accounts are €500-€5,000 per post; budget accordingly.

## 7. Pacing

Marketing requires a cadence, not bursts. Suggested rhythm:

| Day | Activity | Time |
| --- | --- | --- |
| Monday | Run discovery tool, refresh Sheet, plan week's outreach | 1h |
| Tuesday | 20-25 Tier 1 YouTuber emails (personalised) | 4-5h |
| Wednesday | 5 club emails (LinkedIn-sourced) | 3h |
| Thursday | 25-50 Tier 2 YouTuber emails (templated) | 2h |
| Friday | Reply to all inbound, schedule next-week calls, update Sheet status column | 2h |
| Weekend | Reddit + Discord seeding (different format, lower-pressure) | 1-2h |

**Volume per week**: 50-80 emails, 1-2 calls scheduled, 1 club + 1 publisher + 5 creator conversations in progress. This is sustainable for 8+ weeks running into the tournament.

**Do not**: send 500 emails in a single Monday and then go silent for two weeks. The replies arrive over 2-10 days; you need to be available every weekday to convert them.

## 8. What to send when they ask "what do you need from me?"

The most common reply to a successful outreach: "interesting, what do you need from us?". Have these ready as canned snippets:

**For a YouTuber:**
> Two things. 1) Confirm the channel name and a colour hex if you want a custom theme. 2) A 60-second mention in your next video (script attached). I'll send you the admin link tonight and a one-page PDF you can put in your video description.

**For a club:**
> A 15-minute call with whoever owns digital. I'll come with three options for branding, leaderboard scope, and embed placement. We'll have a working branded pool you can review within 48 hours of the call.

**For a publisher:**
> A 30-minute call with your digital product manager. I'll demo the embed live, walk through the data-sharing terms, and leave you with a one-page integration brief your dev team can scope from.

**For a stats/fantasy company:**
> A technical 30-minute call with your product + engineering lead. I'll demo the embed, the data export, and the affiliate routing. We can have a sandbox embed running on a staging URL of yours within a week.

## 9. Ethics, ToS, and law

- **No mass-DMs on YouTube.** YouTube's ToS forbids it and the spam-detection layer is aggressive. Discovery tool extracts the email *from the channel's About page*; that's a public posting, not a scrape. Outreach via email only.
- **No purchased email lists.** Every contact in our outreach Sheet is either self-published (the YouTube About page), LinkedIn-public, or a published company contact address. CAN-SPAM, CASL, and GDPR all permit this.
- **Every outreach email must have an obvious opt-out.** Default: a sentence at the bottom of every templated email reading *"Reply 'no' and I won't contact you again."* The opt-out is *operational*: enforce it. Add anyone who says "no" to a `do-not-contact.csv` in the same Drive folder and grep against it before every send.
- **GDPR for European contacts**: lawful basis is "legitimate interest" (B2B outreach about a relevant product). Document this in the company privacy policy.
- **Sportsbook partners**: any traffic we route to them must comply with their licensed jurisdictions. We do *not* promote sports betting to users from jurisdictions where the partner isn't licensed. The affiliate router (`docs/18-monetization.md`) handles this geo-gating.
- **Club / federation IP**: when we build a club-branded pool, we use *their* assets *with permission*. Never lift a club crest from Wikipedia and ship a pool without sign-off. Confirm in the outreach email and again on the kick-off call.

## 10. Measuring this

Add a `outreach_metrics.md` next to this doc once outreach starts; track weekly:

- Emails sent (split by channel: YT/club/publisher/stats/sportsbook/community)
- Reply rate by channel
- Calls scheduled
- Pools created (live, with at least one entry)
- Pool-entry counts week-on-week
- Cost (mostly time; track hours)

Weekly review: which channel converted best? Double down. Which channel got zero replies after 50 sends? Pause and re-think the pitch before sending more. This is a feedback loop, not a campaign.

## 11. Things to *not* do

- **Don't promise prize money you haven't escrowed.** Either run a free pool or actually hold the cash. Half-promised prizes are the fastest way to turn a community against you.
- **Don't run a club pool without the club's sign-off, even if the colours and crest are "fan-art".** A cease-and-desist from Manchester United is not a launch story.
- **Don't compete with sportsbook partners on price.** We're free-to-play. They're paid. Different products, complementary funnel. The pitch holds only if we don't blur it.
- **Don't follow up more than once.** It's the single biggest mistake new marketers make. One bump. Then stop.
- **Don't pitch the AI-builder story to a football audience.** Save it for `LAUNCH-PLAYBOOK.md` audiences. Football audiences want to know what their viewers/fans/readers get, not how it was built.
- **Don't auto-send.** Every email goes out by hand, with the personalised first line. Auto-senders trip spam filters and read as auto-senders even when they don't.

## 12. The week-one starter list

If you want a 5-hour day-one push, here it is:

1. Run the discovery tool (1h, mostly waiting on API). Produces the master Sheet.
2. Send 10 personalised Tier 1 YouTuber emails (2h).
3. Send 3 club emails to clubs you have a personal LinkedIn route to (1h).
4. Post one "we built a /r/soccer WC2026 pool" thread (15 min, with mod pre-approval).
5. Update the daily session note with what went out, what replies came back, what to do tomorrow (15 min).

Repeat the next day with the next 10 YouTubers and the next 3 clubs. After two weeks you've reached 100 creators and 30 clubs, with the discovery Sheet refreshed once. That's the platform's WC2026 marketing engine in steady state.
