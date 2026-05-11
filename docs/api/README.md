# Tournamental API reference

> For an aggregated, Scalar-rendered view of every public service in
> one place, see the live portal at
> [`tournamental.com/api`](https://tournamental.com/api) (architecture
> in [`../53-api-portal.md`](../53-api-portal.md)). This folder is the
> source of truth: the portal aggregator reads the JSON snapshots
> below at marketing-build time.

Every Fastify service in this repo registers `@fastify/swagger` + `@fastify/swagger-ui`. Each running service exposes:

- `GET /docs`, Swagger UI (interactive)
- `GET /docs/json`, OpenAPI 3.0 spec as JSON
- `GET /docs/yaml`, OpenAPI 3.0 spec as YAML
- `GET /healthz` (or `/health`), liveness probe
- `GET /v1/version`, service identity, package version, spec version

The committed `*.openapi.json` files in this folder are the same JSON the service serves at `/docs/json`. They're checked in so consumers (the dashboard, internal tooling, third-party integrators) don't have to boot the service first.

## Service index

| Service | Port | Healthz | Swagger UI | Static spec |
| --- | ---: | --- | --- | --- |
| [`@vtorn/api`](../../apps/api) | 3310 | `http://localhost:3310/health` | `http://localhost:3310/docs` | [`api.openapi.json`](api.openapi.json) |
| [`@vtorn/auth-sms`](../../apps/auth-sms) | 3330 | `http://localhost:3330/health` | `http://localhost:3330/docs` | [`auth-sms.openapi.json`](auth-sms.openapi.json) |
| [`@vtorn/dm-otp`](../../apps/dm-otp) | 3331 | `http://localhost:3331/health` | `http://localhost:3331/docs` | [`dm-otp.openapi.json`](dm-otp.openapi.json) |
| [`@vtorn/game`](../../apps/game) | 3360 | `http://localhost:3360/healthz` | `http://localhost:3360/docs` (TODO, see swagger.ts) | [`game.openapi.json`](game.openapi.json) |
| [`@vtorn/affiliate-router`](../../apps/affiliate-router) | 3370 | `http://localhost:3370/healthz` | `http://localhost:3370/docs` | [`affiliate-router.openapi.json`](affiliate-router.openapi.json) |
| [`@tournamental/odds-ingest`](../../apps/odds-ingest) | 3375 | `http://localhost:3375/healthz` | `http://localhost:3375/docs` | [`odds-ingest.openapi.json`](odds-ingest.openapi.json) |
| [`@vtorn/vstamp`](../../apps/vstamp) | 3380 | `http://localhost:3380/healthz` | `http://localhost:3380/docs` | [`vstamp.openapi.json`](vstamp.openapi.json) |
| [`@vtorn/social-publisher`](../../apps/social-publisher) | 3382 | `http://localhost:3382/healthz` | `http://localhost:3382/docs` | [`social-publisher.openapi.json`](social-publisher.openapi.json) |
| [`@vtorn/clip-pipeline`](../../apps/clip-pipeline) | 3385 | `http://localhost:3385/healthz` | `http://localhost:3385/docs` | [`clip-pipeline.openapi.json`](clip-pipeline.openapi.json) |
| [`@vtorn/identity`](../../apps/identity) | 3392 | `http://localhost:3392/healthz` | `http://localhost:3392/docs` | [`identity.openapi.json`](identity.openapi.json) |
| [`@vtorn/crm-bridge`](../../apps/crm-bridge) | 3395 | `http://localhost:3395/healthz` | `http://localhost:3395/docs` | [`crm-bridge.openapi.json`](crm-bridge.openapi.json) |
| [`@vtorn/push-notifications`](../../apps/push-notifications) | 3398 | `http://localhost:3398/healthz` | `http://localhost:3398/docs` | [`push-notifications.openapi.json`](push-notifications.openapi.json) |
| [`@vtorn/drips-bridge`](../../apps/drips-bridge) | 3399 | `http://localhost:3399/healthz` | `http://localhost:3399/docs` | [`drips-bridge.openapi.json`](drips-bridge.openapi.json) |
| [`@vtorn/dm-poll-forwarder`](../../apps/dm-poll-forwarder) | 3404 | `http://localhost:3404/healthz` | `http://localhost:3404/docs` | [`dm-poll-forwarder.openapi.json`](dm-poll-forwarder.openapi.json) |
| [`@vtorn/wc2026-data-scripts`](../../apps/wc2026-data) | 3411 | `http://localhost:3411/healthz` | `http://localhost:3411/docs` | [`wc2026-data.openapi.json`](wc2026-data.openapi.json) |

The `@vtorn/game` service's swagger is registered out-of-band via the dump script today, see [`apps/game/src/swagger.ts`](../../apps/game/src/swagger.ts) for the orchestrator's TODO to wire it in `src/server.ts`.

## WebSocket-only services

These don't have an OpenAPI spec, see the WS-message documentation:

| Service | Port | Doc |
| --- | ---: | --- |
| [`@vtorn/stream-server`](../../apps/stream-server) | 4001 | [`stream-server.ws.md`](stream-server.ws.md) |

## Skipped (Python or non-Fastify)

| Service | Reason |
| --- | --- |
| `apps/statsbomb-replay` | Python, see its own `README.md` |
| `apps/wc2026-producer` | Python, see its own `README.md` |
| `apps/mock-producer` | CLI / library, no HTTP server |
| `apps/tournament-bot` | Fastify v4 (telegram webhook handler); `@fastify/swagger@9` requires Fastify v5. To be migrated when the bot moves to v5, tracked in IDEAS.md |
| `apps/web`, `apps/marketing`, `apps/admin`, `apps/native` | front-end / Next.js / Astro / Capacitor, no HTTP API surface |

## How to regenerate every spec

```bash
# All services that have a `dump-openapi` script:
pnpm -r --if-present run dump-openapi

# One service:
pnpm --filter @vtorn/<service> run dump-openapi
```

Each script boots the service in-process via vitest, writes the OpenAPI JSON to this folder, and exits. No port binding, no real DB, no real network. CI re-runs all of them and fails if any committed JSON is stale, this is the standing rule per [`../playbook/06-shipping-a-doc-update.md`](../playbook/06-shipping-a-doc-update.md).

## How to consume a spec

### From the dashboard / TypeScript client

```bash
# Generate a typed client from the static spec
npx openapi-typescript docs/api/game.openapi.json -o src/lib/game-client.d.ts
```

### From the running service

While developing, hit `/docs` in your browser. The Swagger UI lets you exercise endpoints interactively (it reads the same spec the dump script produces).

### From `curl`

```bash
curl -s http://localhost:3360/docs/json | jq '.paths'
```

## Adding swagger to a new Fastify service

See [`../playbook/01-add-a-new-app.md`](../playbook/01-add-a-new-app.md) and [`../playbook/02-add-a-new-fastify-route.md`](../playbook/02-add-a-new-fastify-route.md). The pattern is small and uniform across every service in this folder; copy from any existing one.
