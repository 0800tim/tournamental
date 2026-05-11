# 53, API docs portal

> A single aggregated API reference at `https://tournamental.com/api`
> that surfaces every public Fastify service in the monorepo, with
> per-service deep-links. Built at marketing-build time, snapshot-first
> so it works offline. Apache-2.0 + CC-BY licensed like the rest of the
> repo.

This doc explains the portal architecture, how contributors add a new
service, how the snapshot system works, and how the MCP server (see
the parallel agent's doc in this folder) consumes the same schemas.

## Why this exists

Before the portal:

- Every Fastify service in `apps/*` registered `@fastify/swagger-ui` on
  its own `/docs` endpoint behind its own port/tunnel.
- Integrators had to know about 9+ separate URLs (`game.tournamental.com`,
  `vstamp.tournamental.com`, etc.) and visit each in turn.
- AI agents reading the codebase had to grep the source to know which
  endpoints existed; OpenAPI specs were committed under `docs/api/`
  but there was no rendered view of them.

The portal stitches all of that into one Scalar-rendered reference at
`tournamental.com/api` with deep-links at `tournamental.com/api/<slug>`.

## Architecture

```
                  build-time
                  ----------
apps/<service>/* ----> dump-openapi (vitest) ----> docs/api/<service>.openapi.json
                                                            |
                                                            v
                       apps/marketing/                  snapshots
                       src/lib/api-services.ts ------> aggregator
                                                            |
                                  +-------------------------+--------------------------+
                                  |                                                    |
                                  v                                                    v
                       public/api/openapi-bundle.json                  public/api/<slug>.openapi.json
                       public/api/manifest.json                                       (one per service)
                                  |                                                    |
                                  v                                                    v
                       src/pages/api/index.astro                    src/pages/api/[service].astro
                       (Scalar, all services)                       (Scalar, single service)
```

Three moving parts:

1. **Service manifest** at
   [`apps/marketing/src/lib/api-services.ts`](../apps/marketing/src/lib/api-services.ts).
   The list of public services with slug, package name, description,
   auth model, source path, snapshot filename, and dev/prod URL.
2. **Aggregator script** at
   [`apps/marketing/scripts/build-openapi-index.mjs`](../apps/marketing/scripts/build-openapi-index.mjs).
   Runs as part of `pnpm --filter @vtorn/marketing build`. For each
   manifest entry it tries `${url}/docs/json` then `${url}/openapi.json`
   (live), falling back to `docs/api/<snapshotName>.openapi.json`
   (snapshot). Writes the merged bundle and per-service slices to
   `apps/marketing/public/api/`.
3. **Renderer pages** at
   [`apps/marketing/src/pages/api/index.astro`](../apps/marketing/src/pages/api/index.astro)
   and
   [`apps/marketing/src/pages/api/[service].astro`](../apps/marketing/src/pages/api/[service].astro).
   Both mount Scalar API Reference (MIT) against the relevant bundle.

## Why Scalar and not Swagger UI or Redoc?

- **Single CDN script tag.** Scalar ships
  `@scalar/api-reference@1.x/dist/browser/standalone.js` which mounts
  on `<script id="api-reference" data-url="...">`. No build step, no
  npm dep.
- **Better UX.** Three-pane layout (sidebar / docs / code samples)
  works on 360px viewports without modification. Redoc is fine but
  doesn't ship code samples by default; Swagger UI's interactive
  "try it out" doesn't make sense for an aggregated portal where the
  servers are on different origins.
- **MIT licensed,** compatible with Apache 2.0.
- **Tag-driven filtering.** Scalar honours OpenAPI 3.0 `tags`, which
  is exactly how we group paths per service in the merged bundle.

## How the snapshot system works

Each Fastify service has a `dump-openapi` script (and the
`openapi:snapshot` alias) that boots the service in-process via
vitest, calls `app.swagger()` to extract the spec, and writes it to
`docs/api/<service>.openapi.json`. The script does not bind any port,
does not need a database, and runs in 1, 2 seconds. See
[`apps/affiliate-router/scripts/dump-openapi.ts`](../apps/affiliate-router/scripts/dump-openapi.ts)
for the canonical pattern.

To regenerate every snapshot:

```bash
pnpm -r --if-present run openapi:snapshot
```

To regenerate one:

```bash
pnpm --filter @vtorn/game run openapi:snapshot
```

CI re-runs all of them and fails if any committed JSON is stale, per
[`docs/playbook/06-shipping-a-doc-update.md`](playbook/06-shipping-a-doc-update.md).

## Build-time vs. run-time

The aggregator runs at `pnpm --filter @vtorn/marketing build` time.
That gives us:

- Zero runtime dependencies on the upstream services. The portal is
  pure static HTML + JSON.
- Predictable Cloudflare caching, see below.
- The portal builds successfully when every upstream service is
  offline, as long as the snapshots are committed (they are).

The trade-off is freshness: a spec change in `apps/game` only shows
up in the portal after a marketing redeploy. CI runs the marketing
build on every PR to `main`, so the lag is one CI cycle.

When the upstream service is reachable at build time the aggregator
prefers the live spec, so a fresh deploy + a marketing rebuild gives
the portal the latest. We badge each service in the bundle's
`tags[].x-source-mode` field as either `live` or `snapshot` so the
portal index can tell integrators which view they're getting.

## Cache strategy

The bundle and the per-service slice JSONs are served with:

```
Cache-Control: public, max-age=300, stale-while-revalidate=86400
```

Set declaratively in
[`apps/marketing/public/_headers`](../apps/marketing/public/_headers)
so Cloudflare Pages applies it on prod. Five minutes of fresh cache,
24 hours of stale-while-revalidate, lets a hot Cloudflare edge absorb
all the AI-agent traffic with one origin hit per match-day spike. Per
[`docs/22-deployment-and-tunnels.md`](22-deployment-and-tunnels.md) the
HTML pages themselves are statically rendered, so they get the standard
long edge cache + SWR via the same `_headers` defaults.

## Adding a new service to the portal

1. Add the entry to `API_SERVICES` in
   `apps/marketing/src/lib/api-services.ts`. The slug becomes the
   URL segment (`/api/<slug>`) and the OpenAPI tag.
2. Make sure the service has `@fastify/swagger` registered and a
   `dump-openapi` script. Copy
   [`apps/affiliate-router/scripts/dump-openapi.ts`](../apps/affiliate-router/scripts/dump-openapi.ts)
   if not.
3. Run `pnpm --filter @vtorn/<service> run openapi:snapshot` to
   commit the snapshot to `docs/api/<service>.openapi.json`.
4. Add the `openapi:snapshot` alias to the service's `package.json`
   if missing:
   ```json
   "openapi:snapshot": "pnpm run dump-openapi"
   ```
5. Rebuild the marketing site:
   `pnpm --filter @vtorn/marketing build`. Confirm
   `dist/api/<slug>/index.html` exists.

If the service is internal (admin-only, OTP, etc.) add it to
`SKIPPED_SERVICES` instead so the portal can render an explicit "not
on the public docs" notice rather than a confused 404.

## Services included in v0.1

| Slug | Package | Source |
| --- | --- | --- |
| `game` | `@vtorn/game` | [`apps/game`](../apps/game) |
| `identity` | `@vtorn/identity` | [`apps/identity`](../apps/identity) |
| `vstamp` | `@vtorn/vstamp` | [`apps/vstamp`](../apps/vstamp) |
| `affiliate-router` | `@vtorn/affiliate-router` | [`apps/affiliate-router`](../apps/affiliate-router) |
| `drips-bridge` | `@vtorn/drips-bridge` | [`apps/drips-bridge`](../apps/drips-bridge) |
| `clip-pipeline` | `@vtorn/clip-pipeline` | [`apps/clip-pipeline`](../apps/clip-pipeline) |
| `odds-ingest` | `@tournamental/odds-ingest` | [`apps/odds-ingest`](../apps/odds-ingest) |
| `wc2026-data` | `@vtorn/wc2026-data-scripts` | [`apps/wc2026-data`](../apps/wc2026-data) |
| `api` | `@vtorn/api` | [`apps/api`](../apps/api) |
| `news-aggregator` (parked) | `@vtorn/news-aggregator` | [`apps/news-aggregator`](../apps/news-aggregator) |

The `news-aggregator` entry is on the manifest but has no
`dump-openapi` script yet, so the aggregator currently skips it with a
warning. Adding the script is a v0.2 item; the portal already handles
the missing snapshot gracefully.

## Services intentionally skipped

| Package | Reason |
| --- | --- |
| `@vtorn/auth-sms` | Private OTP, admin-only. |
| `@vtorn/dm-otp` | Internal Discord-DM OTP flow. |
| `@vtorn/dm-poll-forwarder` | Internal Discord poll forwarder. |
| `@vtorn/push-notifications` | Internal cron + push fan-out, no public surface. |
| `@vtorn/social-publisher` | Admin-only scheduler for social posts. |
| `@vtorn/crm-bridge` | Internal GoHighLevel relay. |

These services still ship an OpenAPI snapshot under `docs/api/` so
internal tooling can generate typed clients, but they don't surface
on the public portal.

## MCP server cross-reference

The MCP server agent (see the parallel session's PR) consumes the
same per-service snapshots in `docs/api/` to expose every public
endpoint as an MCP tool, so a Claude / Cursor / Aider client can call
the Tournamental API from inside the editor. The aggregator and the
MCP server intentionally read the same source of truth (`docs/api/`)
so a snapshot regeneration updates both surfaces at once. Search for
`apps/mcp-server` or `docs/mcp-server.md` once the MCP PR lands.

## Path namespacing in the bundle

The merged bundle prefixes every path with `/_/<slug>/` so two
services that happen to share an endpoint (e.g. both define `/healthz`)
don't collide. The per-service slice keeps the original paths intact
so an integrator can copy a curl command straight from the doc and
hit the service directly without rewriting:

```bash
curl https://game.tournamental.com/v1/bracket/me
# from /api/game (slice), original path
```

Component schemas in the bundle are also namespaced (`<slug>_<Name>`)
for the same reason. Per-service slices preserve them untouched.

## What's parked for v0.2

- `news-aggregator` needs its own `dump-openapi` script and a swagger
  registration in `src/index.ts`. The manifest entry is in place.
- A nightly cron that rebuilds the marketing site if any service's
  spec drifted, so a hot-swapped service shows up in the portal
  without waiting for the next CI cycle.
- "Try it out" buttons that route to the right per-service origin so
  Scalar's interactive playground works across services.
- A search index that covers operation summaries + descriptions
  (Scalar's built-in search is good but doesn't reach into request /
  response examples).
