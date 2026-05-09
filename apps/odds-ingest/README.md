# `@vtourn/odds-ingest`

Live prediction-market odds ingest for the VTourn 2026 World Cup bracket.

Pulls W/D/L (and tournament-winner / group-winner) probabilities from
**Polymarket** (primary, no auth) and **The Odds API** (free 500 req/month
backup) into a small SQLite cache, and serves them over HTTP for the
bracket UI to consume.

When neither upstream covers a fixture (typical for late group-stage
matches more than 4-6 weeks out), the service falls back to a deterministic
mock derived from FIFA rankings so every fixture always has a number.

## Run

```bash
pnpm install
pnpm --filter @vtourn/odds-ingest build
pnpm --filter @vtourn/odds-ingest start
# or for dev (no build step):
pnpm --filter @vtourn/odds-ingest dev
```

Default port: **3341**. Override with `ODDS_INGEST_PORT`. The HTTP server
exposes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness + per-source status |
| `GET` | `/v1/odds/match/:matchNo` | W/D/L for one fixture |
| `GET` | `/v1/odds/team/:code/winner` | Tournament-winner probability for one team |
| `GET` | `/v1/odds/team/:code/group` | Group-winner probability for one team |
| `GET` | `/v1/odds/markets?kind=...` | List of markets (optionally filtered by kind) |
| `GET` | `/v1/odds/snapshot` | Compact dump of all current probabilities |

CORS is wide-open. Responses set sensible `Cache-Control` headers so the
upstream Cloudflare cache absorbs traffic spikes.

## Configuration

All config is read from the environment. See `.env.example` for the full
list. Required-ish:

- `ODDS_INGEST_PORT` (default `3341`)
- `ODDS_INGEST_DB_PATH` (default `./data/odds-ingest.sqlite`)
- `POLYMARKET_GAMMA_URL` / `POLYMARKET_CLOB_URL` — defaults are the public
  Polymarket endpoints, no auth needed.
- `THE_ODDS_API_KEY` — **register at https://the-odds-api.com/** for a free
  500 req/month key. If unset, the secondary source is silently disabled
  and we rely on Polymarket + mock.

No paid services. No keys are committed.

## Process model

A single Node 20 process runs concurrently:

- **Gamma poll** every 5 min (configurable via `POLL_GAMMA_MS`) — pulls
  Polymarket market metadata for the World Cup tag slugs.
- **CLOB snapshot** every 30 s (`POLL_CLOB_MS`) — refreshes top-of-book
  bid/ask for every Polymarket market we know about.
- **The Odds API poll** every 60 min (`POLL_THE_ODDS_API_MS`) — conservative
  to stay under the 500 req/month free tier.
- **HTTP server** in the foreground (Fastify).

Each loop is wrapped in its own try/catch with exponential backoff. A
crashing source never takes the HTTP server down; the API gracefully
returns nullable probability fields when no source has covered a fixture
yet.

## Tests

```bash
pnpm --filter @vtourn/odds-ingest test
```

Tests cover normalisation (team-name → FIFA code mapping, vig stripping,
median-of-bookmakers), Polymarket Gamma + CLOB parsing (mocked HTTP), the
poller's idempotency + retry behaviour, and the API contract.

## Deployment

### Local PM2

```bash
pm2 start pm2-ecosystem.config.cjs --only odds-ingest
pm2 save
```

### Cloudflare tunnel

The service binds to **localhost:3341** and is exposed externally via the
existing `aiva-tunnel` per `docs/22-deployment-and-tunnels.md`. Add the
ingress rule the same way other vtourn dev hostnames are added:

```bash
# 1. Pick a hostname (suggested: vtorn-odds.aiva.nz for dev,
#    odds.vtourn.com for prod) and a tunnel.
ACCOUNT_ID=f08ad6bd468886c7d991a817b3bbbeba
TUNNEL_ID=68c2f5b4-8713-441b-9de5-1933557a443b
HOST=vtorn-odds.aiva.nz
PORT=3341

# 2. Create the CNAME record.
cloudflared tunnel route dns "$TUNNEL_ID" "$HOST"

# 3. PUT the merged ingress (see docs/22 for the full snippet).
```

For the prod hostname `odds.vtourn.com`, follow the same flow against the
vtourn.com zone using `infra/scripts/cf-add-vtourn-hosts.sh` as a template.

## Database migration path

The schema (`src/store/schema.sql`) intentionally mirrors the Postgres
schema sketched in `docs/29`. Migrating later is mechanical:

```sql
text          -> text
INTEGER (ms)  -> bigint    (or timestamptz when paired with to_timestamp/1000)
REAL          -> numeric
INTEGER 0/1   -> boolean
```

The existing data can be exported with `sqlite3 odds-ingest.sqlite ".dump"`
and replayed against Postgres after a one-pass `sed`.

## What this service does NOT do (yet)

- **Live WebSocket fanout** to clients. The bracket UI polls `/v1/odds/...`
  with HTTP caching for now; live ticks add real value during in-match
  second-screen mode and will arrive in a follow-up PR per `docs/29`.
- **Player-level top-scorer mapping.** Top-scorer markets are ingested but
  the player ↔ outcome mapping is left null until the players table is
  finalised.
- **Geo-gating / affiliate tracking.** That's `apps/affiliate-router` per
  `docs/30`.
