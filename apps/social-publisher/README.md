# @vtorn/social-publisher

Multi-platform fan-out for VTourn match clips and bracket cards.

Subscribes to `ClipReady` events from the clip-pipeline (`apps/clip-pipeline`)
and publishes the rendered variants to **TikTok**, **Instagram Reels**,
**YouTube Shorts**, **X (Twitter)**, **Threads**, **Telegram**, **Discord**,
**Reddit**, and **WhatsApp** (group fan-out via the Aiva gateway) according
to a per-tournament policy.

See [docs/27-social-distribution-strategy.md](../../docs/27-social-distribution-strategy.md)
for the cadence, hashtag rules, and audience-tier strategy this service implements.

## Status

Four adapters are wired for real API calls; the other five remain
deterministic stubs because they're gated on Meta App Review, Google OAuth
verification, X paid tier, or TikTok Direct Post approval.

| Adapter            | Mode                 | Notes                                                                |
|--------------------|----------------------|----------------------------------------------------------------------|
| Discord            | real (when configured) | Webhook fan-out via `config/discord-webhooks.json`.                 |
| Telegram           | real (when configured) | Bot API direct, or proxy via `TOURNAMENT_BOT_PUSH_URL`.             |
| Reddit             | real (when configured) | OAuth script-app password grant; allowlisted subs only.             |
| WhatsApp           | real (when configured) | Aiva gateway / Baileys; group fan-out.                              |
| TikTok             | stub                 | Gated on TikTok Developer + Direct Post scope approval.              |
| Instagram Reels    | stub                 | Gated on Meta App Review (`instagram_content_publish`).              |
| YouTube Shorts     | stub                 | Gated on Google OAuth verification (sensitive scopes).               |
| X (Twitter)        | stub                 | Gated on paid X API tier ($200/mo Basic).                            |
| Threads            | stub                 | Gated on Meta App Review (`threads_content_publish`).                |

`real (when configured)` means the adapter falls back to deterministic stub
mode if its env vars or per-tournament config are empty — so an
unconfigured deploy never crashes; it just no-ops on those channels and
the audit log records the stub result.

`GET /healthz` reports the live mode for every adapter under
`adapter_modes`.

## Endpoints

| Method | Path           | Purpose                                                  |
|--------|----------------|----------------------------------------------------------|
| `GET`  | `/healthz`     | Liveness + adapter list.                                 |
| `GET`  | `/v1/version`  | Service identity.                                        |
| `POST` | `/v1/publish`  | Accept a `ClipReady` event, fan out per policy.          |

## Running locally

```bash
cd apps/social-publisher
pnpm install
pnpm dev          # http://localhost:3382
```

Smoke-test:

```bash
curl -s http://localhost:3382/healthz | jq
curl -s http://localhost:3382/v1/version | jq

curl -s -X POST http://localhost:3382/v1/publish \
  -H 'content-type: application/json' \
  -d '{
    "clipId": "clip_arg_messi_108",
    "paths": {
      "v9x16": "/clips/clip_arg_messi_108_9x16.mp4",
      "v16x9": "/clips/clip_arg_messi_108_16x9.mp4",
      "v1x1":  "/clips/clip_arg_messi_108_1x1.mp4",
      "og":    "/clips/clip_arg_messi_108_og.png"
    },
    "captions": {
      "en": "Messi makes it 3-2! 108 in extra time of the World Cup Final.",
      "es": "Messi pone el 3-2 en el minuto 108 de la final del Mundial."
    },
    "hashtags": ["#WorldCup2026", "#Messi", "#ARG"],
    "tournamentId": "fifa-wc-2022",
    "matchId": "fifa-wc-2022-final-arg-fra",
    "eventType": "goal"
  }' | jq
```

## Architecture

```
┌─────────────┐  ClipReady  ┌──────────────────┐  fan-out  ┌──────────────┐
│ clip-       │ ──────────▶ │ social-publisher │ ────────▶ │ 8 adapters   │
│ pipeline    │             │ (this service)   │           │ (TikTok ...) │
└─────────────┘             └──────────────────┘           └──────────────┘
                                    │
                                    ▼
                            data/posts.jsonl
                            (append-only audit)
```

- **Adapters** (`src/lib/adapters/<platform>.ts`) — uniform `Adapter` contract:
  ```ts
  interface Adapter {
    platform: Platform;
    publish(clip, ctx): Promise<{ externalId, url }>;
    pullMetrics(post): Promise<{ views, likes, comments, shares }>;
  }
  ```
  A future agent swaps the stub body for real API calls without changing
  the call site.
- **Policy router** (`src/lib/policy.ts`) — maps `eventType` to a list of
  platforms, with per-tournament overrides. See `config/social-policy.json`.
- **Audit log** (`src/lib/audit-log.ts`) — append-only JSONL at
  `data/posts.jsonl`. Every publish (success or failure) writes a row.
  Postgres bridge is a follow-up.
- **Server** (`src/server.ts`) — Fastify v5 + zod validation on the request.

## Caching policy

| Surface            | Header                              | Why                                 |
|--------------------|-------------------------------------|-------------------------------------|
| `POST /v1/publish` | `no-store`                          | Mutates server state.               |
| `GET /healthz`     | `no-store`                          | Liveness must reflect now.          |
| `GET /v1/version`  | `public, max-age=60`                | Stable for the lifetime of a build. |

## Environment variables

| Var                          | Default              | Notes                       |
|------------------------------|----------------------|-----------------------------|
| `SOCIAL_PUBLISHER_PORT`      | `3382`               |                             |
| `SOCIAL_PUBLISHER_BIND`      | `0.0.0.0`            |                             |
| `SOCIAL_PUBLISHER_LOG_PATH`  | `./data/posts.jsonl` | Append-only audit log path. |
| `SOCIAL_PUBLISHER_POLICY`    | bundled JSON         | Override policy file.       |
| `LOG_LEVEL`                  | `info`               |                             |

Real-API env vars per platform live in the TODO block at the top of each
adapter file.

### Discord adapter

Posts via webhook URLs configured per-tournament in
`config/discord-webhooks.json`. Multi-channel fan-out: list more than one
URL per tournament. Webhook URLs are sensitive — treat the file as a
secret when deploying, and only `webhook:<id>` ever appears in logs.

| Var                              | Notes                                  |
|----------------------------------|----------------------------------------|
| `SOCIAL_PUBLISHER_DISCORD_MODE`  | `stub` to force stub mode.             |
| `SOCIAL_PUBLISHER_DISCORD_CONFIG`| Override path to `discord-webhooks.json`. |

Rate-limit: respects `X-RateLimit-Remaining` / `X-RateLimit-Reset-After`
response headers; sleeps between calls when remaining hits 0; honours
`retry_after` on a 429 with one retry.

### Telegram adapter

Two routing modes, tried in order:

1. **Tournament-bot push proxy** — if `TOURNAMENT_BOT_PUSH_URL` and
   `TOURNAMENT_BOT_PUSH_SECRET` are set, the adapter POSTs to
   `${url}/v1/push` with a JSON body. The tournament-bot project doesn't
   currently expose this endpoint; once it does, fan-out runs through its
   rate-limit / quiet-hours / push-policy layer rather than re-implement
   it here.
2. **Direct Bot API** — falls back to
   `https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo` with a
   multipart form. The bot must be admin on the target channel.

Per-tournament chat list lives in `config/telegram-targets.json`. Caption
is `pickCaption + hashtags joined`, hard-capped at 1024 chars.

### Reddit adapter

OAuth script-app password grant, then `POST oauth.reddit.com/api/submit`
with `kind=link`. The clip URL is read from `REDDIT_PUBLIC_CLIP_BASE` (or
the path is used directly if it's already absolute) — Reddit's
v.redd.it native upload pipeline is fragile and tracks as v0.2.

| Var                           | Notes                                          |
|-------------------------------|------------------------------------------------|
| `REDDIT_CLIENT_ID`            | from https://www.reddit.com/prefs/apps         |
| `REDDIT_CLIENT_SECRET`        |                                                |
| `REDDIT_USERNAME`             | bot account                                    |
| `REDDIT_PASSWORD`             | bot account password                           |
| `REDDIT_USER_AGENT`           | unique UA — Reddit bans generic ones           |
| `REDDIT_PUBLIC_CLIP_BASE`     | base URL for clip MP4s                         |

Per-tournament subreddit allowlist lives in `config/reddit-targets.json`.
The adapter enforces a per-subreddit 10-minute cooldown and skips any
clip already posted to that subreddit in the last 24h (when the
`recentPostMs` / `recentSubredditPostMs` hooks are wired — v0.2).

### WhatsApp adapter

WhatsApp fan-out clips to configured WhatsApp groups via the Aiva SMS /
WhatsApp gateway.

| Var                  | Notes                                                              |
|----------------------|--------------------------------------------------------------------|
| `AIVA_SMS_API_URL`   | Gateway base URL (default `http://localhost:9252`).                |
| `AIVA_SMS_API_KEY`   | Bearer token for the gateway.                                      |
| `AIVA_WA_SESSION_ID` | Pre-paired Baileys session id on the gateway.                      |
| `WHATSAPP_GROUP_IDS` | CSV of group jids (e.g. `120363041234567890@g.us,...`).            |

If any of those env vars are unset, the adapter falls back to deterministic
stub behaviour (same as the other 8 adapters) so smoke tests still work.

**Discovering group jids.** Send any message to the target group from the
phone paired with the Aiva gateway, then call the gateway's
`GET /api/v1/whatsapp/sessions/{sessionId}/chats` endpoint to read the jid
back from recent chats. Group jids end in `@g.us` (vs `@s.whatsapp.net`
for direct messages).

**Rate limit.** The gateway accepts at most one message per group every 5
seconds. The adapter applies a per-group token-bucket sleep before each
send so back-to-back goals don't trip the throttle.

**No metrics.** WhatsApp / Baileys does not expose group-message
analytics. `pullMetrics` returns zeros. (Forward-counts may land in the
gateway later — the TODO is in the adapter source.)

## What this layer does NOT do (yet)

- **Real platform API calls** — every adapter is a deterministic stub.
- **OAuth flow management** — no UIs for connecting accounts.
- **Postgres persistence** — JSONL audit log only.
- **Redis stream listener** — POST `/v1/publish` is the only ingress.
- **Metrics persistence** — `pullMetrics` returns mock numbers, doesn't
  store them.

These are tracked as v0.2 work.

## Tests

```bash
pnpm test          # vitest, single fork
pnpm typecheck     # tsc --noEmit
```

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/social-publisher.openapi.json`](../../docs/api/social-publisher.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/social-publisher run dump-openapi
# or @vtourn/odds-ingest / @vtorn/wc2026-data-scripts
```
