# @vtorn/api

> VTorn API service. Fastify, TypeScript, ESM. Owns the public `api.tournamental.com` (dev) / `api.vtorn.com` (prod) surface.

This is the Phase-2 starter. It currently exposes only the health/version endpoints needed for the tunnel to answer cleanly. The events-ingest, predictions, and leaderboard surfaces land in subsequent PRs per `docs/23-analytics-and-marketing-insights.md` and the `tasks/` board.

## Run

```bash
# from repo root
pnpm -F @vtorn/api dev
# → http://localhost:3310
```

Through the dev tunnel: `https://api.tournamental.com/health`.

## Endpoints (today)

| Method | Path           | Purpose                                                 | Cache              |
| ------ | -------------- | ------------------------------------------------------- | ------------------ |
| GET    | `/`            | Service descriptor (links to docs, health, version).    | `public, max-age=60` |
| GET    | `/health`      | Liveness check. Returns `{status, ts}`.                 | `no-store`         |
| GET    | `/v1/version`  | App + spec version. Returns `{service, version, spec_version, env, ts}`. | `public, max-age=60` |

## Endpoints (next)

Tracked in `tasks/BACKLOG.md` `#0010`:

- `POST /v1/event`                — analytics ingest, validated against `packages/spec` event schema where applicable.
- `GET  /v1/matches`              — list available matches.
- `GET  /v1/matches/:id/odds`     — historic odds snapshots (post issue #8).
- `POST /v1/predictions`          — place a prediction (auth-gated).
- `GET  /v1/leaderboards/...`     — Redis-fronted reads per `docs/22` caching matrix.
- `POST /v1/admin/...`            — admin operations (allowlisted, audited).

## Tests

```bash
pnpm -F @vtorn/api test           # vitest, runs against an injected Fastify instance
pnpm -F @vtorn/api typecheck
```

## Caching review (per CLAUDE.md)

- All read endpoints have an explicit `Cache-Control` header.
- Health is `no-store`.
- Service descriptor + version are short-cached at the edge for resilience.
- Future hot-read endpoints will Redis-front; see `docs/22-deployment-and-tunnels.md`.

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/api.openapi.json`](../../docs/api/api.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/api run dump-openapi
# or @tournamental/odds-ingest / @vtorn/wc2026-data-scripts
```
