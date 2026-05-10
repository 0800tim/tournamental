# Polymarket odds integration

> Live prediction-market odds piped into Tournamental as a gamification + social-truth layer. Polymarket is by far the deepest, most-liquid market on the 2026 FIFA World Cup, and its prices are widely cited as the "real" probability of outcomes. Surfacing them in Tournamental turns every prediction into a comparison: *the crowd thinks you're underrating Mbappé. Are you sure?*

## Why this matters (and why it should be everywhere)

1. **Truth signal.** Polymarket is the reference mark for "what does the world actually think." When a user picks Brazil to win the group, showing the live Polymarket-implied probability next to their pick generates instant social pressure ("you're 12% off the consensus") which is the strongest hook we have for repeat engagement.
2. **Free-tier dynamic content.** We are not a sportsbook. We can't show real betting odds in most jurisdictions without licensing. Polymarket's CFTC-regulated US-facing crypto-prediction market sits in a different legal bucket: its prices are public market data we can quote with attribution and a disclaimer.
3. **Differentiator vs every other prediction game.** ESPN, Yahoo, Sleeper — none of them surface real-time prediction-market data. We can.
4. **Drives the tournament-bot side.** Telegram bot can ping users when their pick's market price moves more than ±5% — keeps them re-opening the app.

## What Polymarket exposes

- **CLOB API** (`https://clob.polymarket.com/`) — read-only; current orderbook + last-trade prices for any market. No auth needed for reads.
- **Gamma API** (`https://gamma-api.polymarket.com/`) — market metadata (title, end date, conditions, outcome tokens). Used to enumerate which World Cup markets exist.
- **Subgraph (The Graph)** — historical price + volume data for charts.
- **WebSocket subscription** (`wss://ws-subscriptions-clob.polymarket.com/ws/`) — live orderbook updates per market id; used for the "odds tick live in the renderer HUD" feel.

All three are free and rate-limit reasonable (60 req/min on REST). Auth is only needed for placing orders — we never do that.

## Markets we care about (2026 FIFA World Cup)

Polymarket runs:

| Market kind | Volume tier | Example |
| --- | --- | --- |
| Tournament winner | Massive | "Will Argentina win the 2026 FIFA World Cup?" |
| Final two | Large | "Will [team] make the final?" (per-team binary) |
| Per-group winner | Medium | "Will Brazil win Group G?" |
| Top scorer (Golden Boot) | Medium | "Will Mbappé be top scorer?" |
| Per-match moneyline | Small per match | "Will Argentina beat Mexico?" |
| Per-match scorecast | Tiny | "Will the match end 0-0?" |

Our data layer enumerates and indexes everything tagged `tag: "fifa-2026"` or `category: "Sports/Soccer/World Cup"` from the Gamma API.

## Architecture

```
Polymarket Gamma API ─┐
                      ├─→ apps/odds-ingest (Node TS)  ─→ Postgres `odds_market` table
Polymarket CLOB API ──┘                                 + Redis cache (60s TTL)
                                                        + WebSocket fanout
                                                        ↓
                                  ┌────── apps/api (REST endpoints) ──────┐
                                  │                                        │
                                  ↓                                        ↓
                           apps/web HUD                        apps/web bracket page
                           (live odds tile during            (group winner % per team
                            replay, ticker on goals)          shown next to user pick)
                                  ↓
                           tournament bot (Telegram)
                           push: "your pick moved -8%"
```

## New service: `apps/odds-ingest`

```
apps/odds-ingest/
  package.json              Node 20+, TypeScript, ESM
  src/
    poller.ts               Polls Gamma every 5 min for tag=fifa-2026 markets
    market-store.ts         Postgres upsert (idempotent on market_id)
    clob-snapshot.ts        Pulls CLOB current best-bid/best-ask every 30s for active markets
    ws-listener.ts          Maintains WSS subscription per market_id, fans out via Redis pubsub
    normalise.ts            Maps Polymarket outcome tokens → Tournamental team/player/event ids
  test/
    normalise.test.ts       Unit tests on token-to-team mapping
    poller.test.ts          Mocked HTTP, asserts dedupe + retry
```

Runs as a long-lived process under PM2 on the dev box; later moves to a Kubernetes deployment.

## Postgres schema (added to `infra/db/schema.sql`)

```sql
create table if not exists odds_market (
  id              text primary key,           -- Polymarket condition_id
  slug            text not null unique,        -- our short slug, e.g. "wc2026-winner-arg"
  tag             text not null default 'fifa-2026',
  kind            text not null,               -- 'tournament_winner','group_winner','match_moneyline','top_scorer','scorecast'
  question        text not null,
  outcomes        jsonb not null,              -- [{token_id, label, our_team_code|our_player_id|null}]
  starts_at       timestamptz,
  ends_at         timestamptz,
  resolved        boolean not null default false,
  resolved_outcome text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists odds_tick (
  market_id       text references odds_market(id) on delete cascade,
  outcome_token   text not null,
  best_bid        numeric(8,6) not null,
  best_ask        numeric(8,6) not null,
  last            numeric(8,6),
  volume_24h      numeric(20,4),
  ts              timestamptz default now(),
  primary key (market_id, outcome_token, ts)
);

create index odds_tick_market_recent on odds_tick (market_id, ts desc);
```

Retention: keep raw ticks for 30 days; aggregate to 5-min buckets after that for charting (`odds_tick_bucket`).

## REST endpoints (added to `apps/api`)

| Method | Route | Caching | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/odds/markets?tag=fifa-2026` | `s-maxage=60, swr=600` | List active markets |
| `GET` | `/v1/odds/markets/:slug` | `s-maxage=30, swr=300` | Detail + current best-bid/ask |
| `GET` | `/v1/odds/markets/:slug/history?bucket=5m` | `s-maxage=300` | Time-series for chart |
| `GET` | `/v1/odds/teams/:code/summary` | `s-maxage=60` | All markets where this team is an outcome |
| `GET` | `/v1/odds/players/:id/summary` | `s-maxage=60` | All markets where this player is an outcome |
| `WS`   | `/v1/odds/ws` | n/a | Subscribe to live ticks for given market ids |

All have rate limits (60 req/min/IP, higher for authenticated keys).

## Web surfaces

### 1. Bracket page (`/world-cup-2026`)
Each group card shows, next to each team:
- User's pick toggle (our existing UI).
- A subtle live percentage chip: e.g. `BRA 38%` — the Polymarket implied probability that Brazil wins the group.
- When the user's pick disagrees with the market by more than ±10pp, a small icon appears: a "🤔 you're betting against the market — confident?" tooltip on hover.

### 2. Replay HUD (during match playback)
- Bottom-right tile: `Argentina 1-0 — Polymarket: ARG 78% / DRAW 14% / FRA 8%`.
- Updates every 30s via WS during live matches; on replays, uses historical ticks scrubbed to the current renderer timestamp.
- On goal events, the tile flashes briefly with the new probability snapshot.

### 3. Tournament-winner dashboard (`/world-cup-2026/odds`)
- New page, top-of-tournament leaderboard with each team's current Polymarket probability + 24h move + sparkline.
- Filterable by group / confederation / kit colour.
- Tied to the share-card system: clicking a team generates an OG card showing "Brazil — 22% to win, +3% today".

### 4. Per-user pick comparison
- After the user locks their bracket, the `LockSummary` shows their picks vs the market's consensus picks (the highest-probability team per group/round).
- Score: "You're 67% market-aligned. The two contrarian picks are: Senegal over Norway in Group K, France out in R16."
- Generates an OG card "67% market-aligned — see my picks" — virality fuel.

## Telegram bot integration

The tournament bot (per `docs/13`) gets two new commands and one new push:

- `/odds team:argentina` — current market probability, 24h move, link to chart.
- `/picks` — replays user's bracket with each pick's current market % alongside.
- **Push (opt-in, per match-day)**: "Your pick **Senegal** to top Group K just dropped from 31% to 23% (-8pp) on Polymarket."

## Compliance + disclosure

We are **not a betting product**. We surface third-party prediction market data with attribution. Each surface that shows a Polymarket number must:
- Display "Source: Polymarket. Live prediction-market price, not a guarantee or betting line."
- Link to the source market on Polymarket.
- Not use the word "odds" without "prediction-market" qualifier in jurisdictions with strict gambling-advertising rules (UK, AU, NZ — also the affiliate disclosure regime in `docs/27-social-distribution-strategy.md`).
- Never imply we are facilitating a bet. Never link to "place your bet here".

For the affiliate sportsbook router (`docs/18-monetization.md`), Polymarket can be ONE option for users who want to act on their conviction, but only in jurisdictions where it's permitted. The router's geo-gating already handles this.

## Caching + performance

- **Gamma poll** every 5 min: 1 request, ~30 KB response. Negligible.
- **CLOB snapshot** every 30s × ~50 active markets: 50 × 2 KB = 100 KB / 30s. Manageable.
- **WS connections**: 1 connection per active market. We pool: one WS connection multiplexes all subscriptions via Polymarket's per-market channels.
- **Redis cache**: 60s TTL on `/v1/odds/markets`, 30s on per-market endpoints, hot tier for the top-10 highest-volume markets (always in memory).
- **Web page TTI budget**: the odds chips on the bracket page are fetched **after** initial paint, never blocking. Skeleton placeholder until first response.

## Tests

- `normalise.test.ts` — Polymarket outcome token → our team code mapping for all 48 teams + top 50 player tokens.
- `poller.test.ts` — mocked HTTP, deduplication, retry on 429.
- `clob-snapshot.test.ts` — orderbook snapshot parsing.
- `ws-listener.test.ts` — synthetic WSS upstream, assert fanout via Redis pubsub.
- Playwright e2e: bracket page shows odds chip on each team within 2s of paint.

## Secrets

Add to `.env`:

```
POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
POLYMARKET_CLOB_URL=https://clob.polymarket.com
POLYMARKET_WSS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/
# No auth needed for reads; we never trade.
```

`docs/25-keys-and-secrets-required.md` updated to include this section (with no key required, just URLs).

## Build order

1. **`apps/odds-ingest` poller + Postgres schema + market enumerate** (1 day): pull all 2026 WC markets, normalise outcome tokens to our team/player ids, store. Manual verification that we capture all major markets.
2. **CLOB snapshot loop + Redis cache + REST endpoints** (1 day): the read-side, no WS yet.
3. **Bracket page odds chips** (half-day): the highest-impact surface.
4. **Replay HUD odds tile** (half-day): waits for fidelity Phase 4 (HUD layer) to land first.
5. **WS live updates + WSS endpoint** (1 day): real-time ticks.
6. **Tournament-winner dashboard page** (half-day): the per-team page.
7. **Telegram bot commands + push** (half-day): driven by tournament-bot agent.
8. **Compliance pass + per-jurisdiction disclosures** (half-day): legal copy review.

Total: about 5 working days. Phase 1-3 fidelity is parallelisable; this can run alongside.

## Risks + mitigations

- **Polymarket rate limit hit during launch surge**: mitigate by aggressive Redis caching and a 30s snapshot floor for non-WS clients; WS is per-connection so doesn't pressure REST.
- **Token mapping drift**: Polymarket changes a market's question text and we lose the team mapping. Mitigation: normalise on `condition_id` not on text; manual review queue for any new market that doesn't match an existing mapping.
- **Legal challenge in jurisdiction X**: kill-switch flag (`feature.odds = false`) at the per-country geo level; falls back to the bracket page without the chips.
- **Polymarket itself shutting down World Cup markets** (unlikely; volume is huge): fall back to **Kalshi** as a secondary source. Kalshi has a similar API and overlaps on the major markets. Build the ingest with a `source` column so we can multi-source.

## What to do today

1. Start the **`apps/odds-ingest`** scaffold + Gamma poller + Postgres schema.
2. Wire **`/v1/odds/markets?tag=fifa-2026`** end-to-end so we have a JSON we can curl.
3. Drop a tiny **`<OddsChip>`** React component on each `GroupCard` showing `pp%` next to each team — fed from the new endpoint.

That's the credible Day-1 demo: open the bracket page, see live Polymarket numbers next to every team. Everything else is on top.
