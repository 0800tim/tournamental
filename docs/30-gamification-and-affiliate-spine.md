# 30 — Gamification + affiliate revenue spine

> The single most important document in this repo for the **business**. Polymarket-driven live odds, early-lock scoring, market-pressure push, second-screen live-match mode, pay-TV affiliate router, and the affiliate funnel that monetises the whole thing. Free-to-play core; everywhere it's legal, the natural CTA is "back your conviction on Polymarket via our link" or "watch live on broadcaster X via our link".
>
> Companion docs:
> - [docs/29-polymarket-odds-integration.md](29-polymarket-odds-integration.md) — the live-odds data plumbing
> - [docs/18-monetization.md](18-monetization.md) — full revenue model + NZ regulatory constraint
> - [docs/24-gamification-and-virality.md](24-gamification-and-virality.md) — badge/streak primitives this doc builds on
> - [docs/27-social-distribution-strategy.md](27-social-distribution-strategy.md) — share-card mechanics
> - [docs/13-tournament-bot.md](13-tournament-bot.md) — Telegram push surface
> - [docs/31-live-commentary-overlay.md](31-live-commentary-overlay.md) — user-selectable commentary

## The one-paragraph pitch

The user's bracket is never finished. From the moment they make their first pick, every remaining day shows them how the world's biggest prediction market disagrees with them. They get points for being right; **bigger points for locking in early**; even bigger points for being right *and* contrarian. Then on match day, the app becomes a **second screen** — phone in one hand, broadcast on TV — and they keep playing through quizzes and micro-markets while the real game runs. Every push, every share-card, every odds-chip is a chance to look at Polymarket and act on their conviction. The user can also buy a streaming pass via our affiliate link to actually watch the match. We get paid both ways.

## The flagship launch URL: `2026wc.tournamental.com`

The bracket game is **the** launch product. Its canonical URL is **`https://2026wc.tournamental.com`** — not buried under `/world-cup-2026` on a generic app subdomain.

- **Landing page**: `2026wc.tournamental.com` lands directly on the bracket game / second-screen view.
- **Marketing site CTAs** (`www.tournamental.com`): every "Play the bracket game" / "Make your picks" button points at `2026wc.tournamental.com`.
- **Social cards**: all OG URLs use `2026wc.tournamental.com`.
- **Telegram bot**: `/start` deep links land on `2026wc.tournamental.com`.
- **Future tournaments**: `euro2028.tournamental.com`, `copa2027.tournamental.com`, `2027nrl.tournamental.com`. Easy memorable URLs that creators can share verbally.

Routing: Cloudflare tunnel routes `2026wc.tournamental.com` and `app.tournamental.com` to the same Next.js on `:3300`. The Next.js app uses host-based middleware: requests to `2026wc.tournamental.com` resolve to the bracket page as the root.

## Two-axis scoring (the spine)

We score every pick on two axes that multiply:

```
score(pick) = base_correctness × early_lock_multiplier × contrarian_multiplier
```

### Base correctness
- Group winner correct: 100 pts
- Group runner-up correct: 50 pts
- Made knockout correct (bool per team): 25 pts
- R32 winner: 200 pts
- R16 winner: 400 pts
- QF winner: 800 pts
- SF winner: 1500 pts
- Final winner: 3000 pts
- Final score (exact): 5000 pts
- Top scorer correct: 2000 pts

### Early-lock multiplier (the headline mechanic)

Every pick decays a multiplier from `5.0×` at "draw + 24h" down to `1.0×` at the moment that pick's outcome window opens (group kickoff for group picks; round kickoff for knockout picks). Smooth exponential decay so locking earlier always pays:

```
lock_mult(t) = 1.0 + 4.0 × exp(-3 × (t / window))
```

| When user last touched the pick | Multiplier on group winner |
|---|---|
| Within 24h of draw | 5.0× |
| 1 week before kickoff | ~2.4× |
| 1 day before kickoff | ~1.4× |
| At kickoff | 1.0× |

**Loyalty bump**: every time the user *opens* their bracket but doesn't change a pick, they get a passive `+0.05×` "loyalty bump" on that pick — capped at `5.0×`. Reward for not flinching.

### Contrarian multiplier

If a pick **wins** AND was a market underdog at lock time:

| Polymarket implied prob at lock | Mult on win |
|---|---|
| > 50% (favourite) | 1.00× |
| 30-50% | 1.25× |
| 15-30% | 1.75× |
| 5-15% | 2.50× |
| < 5% | 4.00× |

A correct pick on a 6% Polymarket underdog locked 5 weeks before kickoff is worth: `100 × 5.0 × 4.0 = 2000 pts` for a single group winner.

This **forces the user to look at the odds before locking** — which is the primary mechanism for affiliate-funnel touch-points.

## The "never finished bracket" engagement loop

```
   pick → live odds chip appears next to your pick
     → market moves
       → push: "MEX dropped 8pp — change pick?"
         → user opens app
           ↓
      either: (a) change pick (lock multiplier resets to current value)
              (b) hold pick (loyalty bump +0.05×)
              (c) tap odds chip → affiliate CTA
                  → external Polymarket signup
                  → first deposit
                  → we get paid
```

Every loop is a chance for the user to:
1. Stay engaged with the bracket (good for retention).
2. Click an odds chip and bounce to Polymarket (good for revenue).
3. Share their alignment / disagreement on social (good for growth).

The loop runs continuously from "draw + 24h" through "final whistle of the final" — about 5 weeks for a World Cup.

## Push system (the heartbeat)

The Telegram bot + (later) PWA push pings users on:

| Trigger | Copy template |
|---|---|
| Their pick moved more than ±5pp on Polymarket | "Heads up — your pick {team} just dropped from {old}% to {new}% on the market. Change pick?" |
| Lock multiplier about to fall below a band | "{team} multiplier expires in 24h. Lock now to keep 3.5× on this pick." |
| A team they didn't pick is now a heavy favourite | "Brazil's now at 38% to win their group. You've got Switzerland — confident?" |
| Their bracket leaderboard rank dropped | "You've fallen 12 places to #847 in NZ. {team} winning made the difference." |
| 24h before kickoff | "Final hour to lock in {group} — see latest market %." |
| Match they predicted is starting in 5 min | "{Argentina} {kickoff time}. Your pick: {ARG to win}. Live in 5 min." |
| Goal in a match relevant to their bracket | "{Argentina} just scored. Your bracket's looking good." |
| **Affiliate CTA push (geo-permitted only)** | "Confident in {team}? Polymarket has them at {prob}%. Open an account — sign up bonus: $20 free trade." |
| **Pay-TV affiliate push (geo-permitted)** | "ARG vs FRA in 30 min. Watch live: Sky NZ 4-week pass $14.99 →" |

Push frequency cap: **3/day max per user** unless explicitly opted in for "match-day full coverage". Quiet hours respected per user TZ. Affiliate pushes are separate and require explicit opt-in.

## Leaderboards (the social pressure)

Five concurrent leaderboards, every user sees their rank in all five:

1. **Global** — every user, every country.
2. **Country** — Cloudflare-IP-derived. NZ leaderboard is its own thing (NZ rules).
3. **Friends** — explicit invite list (Telegram handle import).
4. **This week** — points earned in the trailing 7 days. Resets weekly.
5. **Affiliate-cohort** — users who joined via the same referral code. Used for creator leagues.

Leaderboard hits a Redis ZSET that updates every 60s. A "share my rank" generates an OG card per `docs/27`.

## Daily/weekly hooks

- **Pick of the day** (group stage): a featured market with elevated multiplier (1.2× cap on the group winner pick). One per day. Drives daily opens.
- **Weekly recap** (post-MD7): personalised page showing every pick's market move that week, points earned, and the next week's most-volatile markets. Shareable.
- **Locked-in early league**: a leaderboard-within-the-leaderboard for users who locked their full 12 group winners within 48h of the draw. Special "you don't flinch" trophy.

## Bracket UI changes (concrete)

### `<GroupCard>` (in `apps/web/components/bracket/`)
- Each team line: `[ flag ] [ team-name ] [ ⚪ pick-toggle ] [ 38% market chip ]`
- Market chip is the live Polymarket implied prob, refreshes every 60s via `/v1/odds`.
- If user pick **disagrees** with market favourite by ≥10pp: subtle yellow `🤔` icon next to the pick toggle.
- The tap on the chip opens a per-team **odds drawer**.

### `<OddsDrawer>` (NEW)
Slide-up drawer showing:
- Sparkline of last 14 days of probability for this team.
- Same for the runner-up favourite in the same group.
- "Lock multiplier" current value for this pick.
- A **"Back this on Polymarket →"** button (geo-gated). Tapping it logs `affiliate_click`, opens Polymarket with our affiliate ref.

### `<LockSummary>` (existing — extend)
After user locks their bracket:
- Per-pick multiplier table.
- "Total possible points from your current locks: X".
- "Market alignment: 67%".
- "Your most contrarian pick: Senegal over Norway (8% to win Group K) — locked early, worth up to 2000 pts if right."
- "**Back your boldest pick →**" CTA (geo-gated).

### `<AffiliateCTA>` (NEW)
A dedicated component used in: lock summary, odds drawer, share cards, weekly recap, replay HUD, and the pre-match second-screen view.

```ts
<AffiliateCTA
  source="odds-drawer"
  kind="polymarket-trade" | "paytv-stream"
  marketId={market.id}
  outcomeToken={team.outcomeToken}
  campaignId={campaignId}
  copy="Back Argentina on Polymarket → first trade $20 free"
/>
```

Geo-gated via Cloudflare `cf-ipcountry`. Renders nothing for restricted countries.

## Second-screen mode (live-match companion)

> Once a match is in progress, the bracket-pick is locked but the user is far from finished. The app becomes a **second screen** — phone in hand, watching the game on TV (or a Pay TV stream sold by us), tapping for the next 90+ minutes.

### What's running concurrently during a live match

- **Pre-match locked bracket pick** — sits there, scoring as the result settles.
- **Live odds tile** — Polymarket per-match prices update every 30s, plus instant tick on goals.
- **Live quiz drops** — every ~7-10 minutes during play, a quick prompt: "Next throw-in to who?", "Goal in the next 5 minutes?". 5-second answer window. 5-50 in-match points.
- **In-match prediction markets** — short-window predictions on shots-in-the-next-5-min, half-time-correct-score, next-card-colour. Each has a multiplier based on its remaining window. Each market line is **also** a Polymarket market the user can trade on with the affiliate CTA.
- **Live commentary audio** — pre-rendered transcripts from `data/commentary/` for replays; ElevenLabs WSS streaming for live (per `docs/31`).
- **Pay-TV stream affiliate** — see below.

### Live points currency

A separate ledger from bracket points so users can keep playing the second-screen even if their bracket is dead.

- **Live points** earned per quiz / per micro-prediction.
- **Daily live leaderboard** — top scorers over 24h.
- **Convert** to bracket-bonus at the end of the tournament: every 1000 live points → +100 bracket points. Caps at 5000 bracket points so live grinders can't overtake bracket-correct players.

### Live-match sequence

```
T-0:30:00 (30 min pre-kickoff)
   ├ Push: "Argentina vs France in 30 min. Open the second screen."
   ├ App opens to live-match view: bracket pick at top, live odds tile, lineup graphics
T-0:00:00 kickoff
   ├ Live commentary audio starts
   ├ Quiz cadence engages
T+0:07:00
   ├ Quiz drop #1
T+0:23:00 goal
   ├ Live tile flashes ARG 78% / DRAW 14% / FRA 8%
   ├ "ARG just scored — your bracket pick is in the green"
   ├ Affiliate push (geo-gated): "ARG now 78% to win. Trade on Polymarket?"
T+0:45:00 half-time
   ├ Half-time recap auto-card to share
   ├ HT-correct-score market settles
   ├ HT-second-half-prediction market opens (5 min window)
T+1:30:00 full-time
   ├ Bracket pick scored
   ├ Live points recap, weekly leaderboard updates
   ├ Share card auto-generates with final result
```

### Components to add (in `apps/web/components/live/`)

- `<LiveMatchView>` — top-level second-screen layout
- `<LiveOddsTile>` — bottom-right floating tile, ticks every 30s
- `<QuizDrop>` — modal with countdown timer, 5s answer window
- `<MicroMarketCard>` — short-window prediction with affiliate CTA
- `<LivePointsLedger>` — sidebar showing accumulated live points + leaderboard rank
- `<PayTVStreamCTA>` — geo-gated banner (see below)
- `<BracketPickReminder>` — subtle "your bracket pick: ARG to win" pinned at top

All listen to a single match-event WebSocket. Reuses the `@tournamental/spec` event types.

### API endpoints (additions to `apps/api`)

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/live/match/:id` | Current state + latest event id |
| `GET` | `/v1/live/match/:id/odds` | Live Polymarket odds for this match |
| `WS`  | `/v1/live/match/:id/events` | Push event stream + quiz drops |
| `POST` | `/v1/live/quiz/:dropId/answer` | Submit answer, returns points if correct |
| `POST` | `/v1/live/market/:id/predict` | Submit micro-market prediction |

### Live points anti-abuse

- Max 1 quiz answer per drop per user. Server-side dedupe.
- Quiz answers locked at the moment the relevant outcome enters the window.
- Server-canonical timer; client clock is not trusted.

## Pay-TV affiliate (third revenue lane)

> Many users will want to actually watch the live games on TV. We resell streaming subscriptions for whatever broadcaster has the rights in their country, and we get an affiliate cut on every sign-up.

### Why this lane

- World Cup TV rights are sold per country: BBC/ITV (UK), Optus Sport / SBS (AU), Sky (NZ), Fox/Telemundo (US), TF1/M6 (FR), beIN (MENA), and so on.
- Most broadcasters run affiliate programmes via Impact, CJ, or direct.
- A single user signing up for a one-month streaming pass is typical USD $20-40 with affiliate cuts of 8-25%.
- Sign-up timing aligns perfectly with our funnel: they have a bracket, we know the country, the next match relevant to their picks is in N hours, we can show "Watch ARG vs FRA on Sky for $14.99 — 4 weeks tournament pass".

### Implementation

```
apps/affiliate-router/
  src/
    providers/
      polymarket.ts                 (prediction-market provider)
      kalshi.ts                     (secondary)
      paytv-sky-nz.ts               (NZ pay TV)
      paytv-foxsports-au.ts         (AU)
      paytv-fubo-us.ts              (US)
      paytv-foxsports-us.ts         (US)
      paytv-itv-uk.ts               (UK)
      paytv-tf1-fr.ts               (FR)
      paytv-bein-mena.ts            (MENA)
      ...
    select-providers.ts             — geo + match → ranked provider list
    track-click.ts                  — log + redirect with affiliate ref
```

Same `<AffiliateCTA>` pattern, just different `kind`:
```ts
<AffiliateCTA
  kind="paytv-stream"
  matchId={match.id}
  copy="Watch ARG vs FRA live — Sky 4-week pass $14.99"
  geoCountry="NZ"
  campaignId={campaignId}
/>
```

Per-match the user sees ONE primary stream CTA (their country's most popular broadcaster) plus a "more options" link.

### Surfaces

1. **Pre-match push** (T-0:30): "ARG vs FRA in 30 min. Watch live: [Sky NZ — 4-week pass $14.99]"
2. **Live-match-view banner**: small ribbon top of screen, dismissable per match.
3. **Bracket page header**: "Watching all 104 matches live? See best stream packages for [country]."
4. **Match-card** in fixtures list: "Live" badge + stream CTA per match.
5. **Onboarding flow**: first time the user lands on `2026wc.tournamental.com`, ask "Want help finding the best stream subscription for [auto-detected country]?" — soft CTA, dismissable, never blocking.

### Geo-gating

Pay-TV affiliate is country-specific by definition. Each provider declares which `cf-ipcountry` codes it serves; the router only shows providers that match.

### Stream coverage rollout

Day 1 of the affiliate router we ship support for the top 8 markets:

1. US (Fubo, Fox, Telemundo)
2. UK (BBC iPlayer is free; ITVX is free; we ship a "free" badge — no affiliate but builds trust)
3. AU (Optus Sport)
4. NZ (Sky NZ — needs verification of affiliate programme)
5. FR (TF1, M6)
6. DE (Magenta, Telekom)
7. BR (Globo, SporTV)
8. ES (Telecinco, Movistar)

Remaining ~40 broadcaster relationships ship over first 6 weeks post-launch.

## Affiliate plumbing (Polymarket + Pay TV)

### Tracking model
- Mint a campaign UUIDv7 per `(user_id, provider, market_id|match_id, surface)` tuple.
- Pass affiliate ref param per-provider format.
- Affiliate console (per provider) gives back: signups, first deposit, ongoing volume, attributed revenue.
- Reconcile daily report against our `affiliate_click` events.

### Revenue waterfall (Polymarket)
- Click only: $0
- Sign-up: typical $5-15
- First deposit: typical 25-40% of deposit amount up to a cap
- Ongoing volume: typical 5-25% of trading fees, in perpetuity. **The big one** — a serious user generates monthly revenue for years.

### Revenue waterfall (Pay TV)
- Click only: $0
- Sign-up + payment: typical 8-25% of subscription value, often one-shot per user.
- Recurring: some providers pay on renewal (better terms).

### A/B testing
Every CTA copy + placement combination is a campaign. Test:
- Copy variants
- Placement (drawer vs lock-summary vs push vs share-card vs match-card)
- Timing (at-lock vs market-move-trigger vs daily-recap vs T-30-pre-match)

Tracked via the existing analytics event pattern from `docs/23-analytics-and-marketing-insights.md`.

## Geo-gating (regulatory must-have)

Per `docs/18-monetization.md`:

| Region | Polymarket affiliate? | Pay-TV affiliate? | Fallback |
|---|---|---|---|
| NZ | NO (illegal) | YES (Sky NZ etc.) | Show "view market" link only for Polymarket |
| AU | NO | YES (Optus, Fox) | Same fallback |
| UK | Conditional (FCA framing) | YES (free BBC/ITV badges) | Market info, no signup CTA |
| US | YES (CFTC-regulated) | YES | Full CTA |
| EU | Mostly YES | YES | Full CTA |
| Crypto-friendly | YES | YES | Full CTA |

`feature.affiliate_polymarket` and `feature.affiliate_paytv` flags resolve per `cf-ipcountry`. Server-side gated on the click endpoints.

## Free-to-play stays the product

A user who never clicks an affiliate link must still have an excellent game. Specifically:
- All bracket mechanics work without an affiliate click.
- All second-screen mechanics work without an affiliate click.
- Leaderboards, push, social cards work without an affiliate click.
- The "Back this on Polymarket" / "Watch on Sky" CTAs are **never required** — they're adjacent.
- We never gate score/leaderboard/feature access on having clicked anything.

Non-negotiable. If users feel the game is a vehicle for affiliate clicks, retention dies.

## Anti-abuse

- Same-IP detection on suspiciously high lock multipliers.
- Affiliate click throttling: max 3 click events per user per market per 24h.
- Bracket edit limit: 200 edits per pick per tournament.
- Server-side recompute of all multipliers at scoring time.
- Quiz answer dedupe.

## Build order (concrete sprint, ship by Mon-Fri)

| Day | Task | Owner | Acceptance |
|---|---|---|---|
| 1 (Mon) | `apps/odds-ingest` Gamma poller + Postgres `odds_market` table | odds-ingest agent | curl `/v1/odds/markets?tag=fifa-2026` returns ≥30 markets |
| 1 (Mon) | Outcome-token → team-code mapping + `/v1/odds/markets/:slug` | same | every market has team_code/player_id mapping |
| 2 (Tue) | `<OddsChip>` component on `<GroupCard>` + score formula extended | bracket-engine agent | bracket page shows pp% next to every team within 2s of paint; unit tests cover all multiplier bands |
| 2 (Tue) | `<OddsDrawer>` component + `lib/geo.ts` country resolver | same | tap chip opens drawer with sparkline + lock-mult |
| 3 (Wed) | `<AffiliateCTA>` component + `/v1/affiliate/click` endpoint | api agent | click logs to Postgres, redirects to Polymarket with ref param |
| 3 (Wed) | `apps/affiliate-router` provider abstraction + 8 paytv providers | affiliate-router agent | each provider returns valid affiliate URL given match + country |
| 4 (Thu) | Push notification triggers (market move, lock-mult expiry, kickoff, paytv) | tournament-bot agent | Telegram bot sends template messages on synthetic event stream |
| 4 (Thu) | Leaderboard ZSETs + `/v1/leaderboard/{scope}` endpoints | api agent | top 100 + user's own rank query in <50 ms |
| 4 (Thu) | `<LiveMatchView>` second-screen scaffold | live-mode agent | second-screen view loads on `/match/:id/live` |
| 5 (Fri) | `<QuizDrop>` + `<MicroMarketCard>` + live points ledger | live-mode agent | quizzes fire on synthetic match, points ledger updates |
| 6 (Sat) | `<PayTVStreamCTA>` + per-country provider matching | live-mode agent | NZ user sees Sky NZ; AU user sees Optus |
| 7 (Sun) | E2E Playwright across the loop | qa agent | lock → market move → push → return → click test passes |
| 7 (Sun) | Compliance review of every copy string | reviewer agent | no FCA/NZ DIA/ACMA-flagged language anywhere |

Total: 7 days, ships in time for go-to-market window.

## Risks + mitigations

1. **Polymarket affiliate program terms change.** Mitigation: provider-pluggable abstraction. Kalshi as #2; PrizePicks; TAB NZ.

2. **Polymarket adds geo-restrictions we don't catch.** Mitigation: provider returns per-country availability list; affiliate CTA double-checks.

3. **Pay-TV broadcaster won't sign affiliate deal.** Mitigation: free badge for free-to-air (BBC/ITV), and the user can self-discover. Keep the CTA editorial.

4. **Lock multipliers create perverse incentives.** Mitigation: server-side validation; review band tail end of group stage.

5. **Push frequency drives unsubscribes.** Mitigation: hard cap 3/day; "match-day-only" preset; clear unsubscribe; quiet hours.

6. **Compliance copy slips through.** Mitigation: lint rule flagging "place a bet" / "guaranteed win" / "sure thing" in tracked-string files.

## Success metrics (90 days post-launch)

- Daily active users — target 30% of registered.
- Pushes opened — target 25% open rate sustained.
- Bracket edit rate — target 60% of users edit at least one pick after lock.
- Odds-drawer open rate — target 40% of bracket viewers open at least one drawer.
- Affiliate click-through rate (Polymarket) — target 8% of bracket lockers.
- Affiliate signup rate — target 25% of clicks → signup.
- Affiliate first-deposit rate — target 15% of signups → first deposit.
- Pay-TV CTA click-through — target 12% in match-week.
- Pay-TV signup rate — target 20% of clicks.
- Implied revenue per affiliate-eligible user (90 days) — target USD $4-12 across both lanes.

## What NOT to do

- Don't make the game feel like a sportsbook.
- Don't trick users into clicking. CTAs must be honest.
- Don't show Polymarket affiliate CTAs in NZ/AU. Test every release with forced `cf-ipcountry`.
- Don't rely on a single affiliate provider per lane. Polymarket + Kalshi for predictions; multiple paytv providers per country.
- Don't put gambling-language in `apps/marketing` — free-to-play prediction game, full stop.

## Open questions for Tim

1. **Polymarket affiliate paperwork** — register Tournamental Holdings as the affiliate party. Banking + KYC required. Recommend doing this Mon in parallel with first sprint day.
2. **Pay-TV provider outreach** — recommend signing up for Impact and CJ Affiliate networks (cover most broadcasters); Sky NZ direct; Optus AU direct.
3. **NZ audience copy** — for NZ users, the Polymarket CTA is hidden. Should the chip itself stay (editorial market intel) or be hidden? Recommend keeping the chip — it drives bracket engagement even without the affiliate.
4. **First-deposit attribution** — does Polymarket's affiliate console expose a postback/webhook? Need to register and verify Mon.
5. **Sign-up bonus copy** — any specific Polymarket promo we should reference verbatim? E.g. "$20 free trade" or whatever's current.
