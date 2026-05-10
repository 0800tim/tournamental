# @vtorn/social-publisher

Multi-platform fan-out for VTourn match clips and bracket cards.

Subscribes to `ClipReady` events from the clip-pipeline (`apps/clip-pipeline`)
and publishes the rendered variants to **TikTok**, **Instagram Reels**,
**YouTube Shorts**, **X (Twitter)**, **Threads**, **Telegram**, **Discord**,
and **Reddit** according to a per-tournament policy.

See [docs/27-social-distribution-strategy.md](../../docs/27-social-distribution-strategy.md)
for the cadence, hashtag rules, and audience-tier strategy this service implements.

## Status: v0.1 — adapter stubs only

Every adapter currently returns a deterministic mock external ID + URL. No
real platform API calls happen yet. Each adapter file (`src/lib/adapters/*.ts`)
has a `TODO` comment block listing the real endpoint, the env vars it expects,
and the auth flow needed.

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
