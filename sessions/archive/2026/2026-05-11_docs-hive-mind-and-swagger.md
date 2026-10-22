# Session — docs hive-mind index + glossary + playbook + Swagger/OpenAPI for every Fastify service

**Date:** 2026-05-11
**Branch:** `feat/docs-hive-mind-and-swagger`
**Worktree:** `/home/clawdbot/clawdia/projects/vtorn-docs-swagger`
**Status:** ready for PR

## Goal

Two things, per Tim's overnight ask:

1. Build a hive-mind brain in `docs/` so any future agent can read `docs/README.md` and find what it needs.
2. Stand up Swagger/OpenAPI for every Fastify service — `/docs` UI + a static committed JSON spec under `docs/api/<service>.openapi.json`.

## Files added

### Hive-mind index

- `docs/README.md` — agent-readable index grouped by surface (start here, architecture, product, process, API, glossary).
- `docs/glossary.md` — alphabetical domain-term reference (StageId, BracketPrediction, VStamp, Humanness Score, Aiva, etc).

### Playbooks

- `docs/playbook/01-add-a-new-app.md`
- `docs/playbook/02-add-a-new-fastify-route.md`
- `docs/playbook/03-debug-a-failing-pr.md`
- `docs/playbook/04-merge-conflict-resolution.md`
- `docs/playbook/05-rolling-out-a-feature-flag.md`
- `docs/playbook/06-shipping-a-doc-update.md`

### API reference

- `docs/api/README.md` — service index with ports, healthz, swagger-UI URLs, regen instructions.
- `docs/api/stream-server.ws.md` — WS protocol for the WebSocket-only stream-server.
- 15 committed OpenAPI 3.0 specs:
  - `docs/api/api.openapi.json`
  - `docs/api/auth-sms.openapi.json`
  - `docs/api/crm-bridge.openapi.json`
  - `docs/api/identity.openapi.json`
  - `docs/api/dm-otp.openapi.json`
  - `docs/api/dm-poll-forwarder.openapi.json`
  - `docs/api/affiliate-router.openapi.json`
  - `docs/api/drips-bridge.openapi.json`
  - `docs/api/game.openapi.json`
  - `docs/api/push-notifications.openapi.json`
  - `docs/api/social-publisher.openapi.json`
  - `docs/api/vstamp.openapi.json`
  - `docs/api/clip-pipeline.openapi.json`
  - `docs/api/wc2026-data.openapi.json`
  - `docs/api/odds-ingest.openapi.json`

### Per-service swagger wiring (12 services)

Each gets a `src/swagger.ts` (the registerSwagger helper) and a `scripts/dump-openapi.ts` + `scripts/dump-openapi.run.ts` + `scripts/dump-openapi.vitest.config.ts` trio that runs the dump via vitest's resolver (necessary because `@vtorn/spec` ships a `.ts` main without `"type": "module"`, which tsx + Node 24's loader can't bridge):

- `apps/api/{src/swagger.ts, scripts/dump-openapi.{ts,run.ts,vitest.config.ts}}`
- `apps/auth-sms/{src/swagger.ts, scripts/...}`
- `apps/crm-bridge/{src/swagger.ts, scripts/...}`
- `apps/identity/{src/swagger.ts, scripts/...}`
- `apps/dm-otp/{src/swagger.ts, scripts/...}`
- `apps/dm-poll-forwarder/{src/swagger.ts, scripts/...}`
- `apps/affiliate-router/{src/swagger.ts, scripts/...}`
- `apps/drips-bridge/{src/swagger.ts, scripts/...}`
- `apps/game/{src/swagger.ts, scripts/...}` (TODO comment — see below)
- `apps/push-notifications/{src/swagger.ts, scripts/...}`
- `apps/vstamp/{src/swagger.ts, scripts/...}`
- `apps/wc2026-data/{src/swagger.ts, scripts/...}`

For `apps/clip-pipeline`, `apps/social-publisher`, `apps/odds-ingest`: swagger is registered inline inside `buildApp` (these don't have a separate `buildServer`); the swagger.ts files are not present for these three.

## Files modified

### Service bootstraps (registerSwagger calls)

- `apps/api/src/server.ts` — `await registerSwagger(app);`
- `apps/api/src/routes/health.ts` — added schema for /health
- `apps/api/src/routes/version.ts` — added schema for /v1/version
- `apps/auth-sms/src/index.ts`
- `apps/crm-bridge/src/server.ts`
- `apps/identity/src/index.ts`
- `apps/dm-otp/src/index.ts`
- `apps/dm-poll-forwarder/src/index.ts`
- `apps/affiliate-router/src/server.ts`
- `apps/drips-bridge/src/server.ts`
- `apps/push-notifications/src/index.ts`
- `apps/vstamp/src/server.ts`
- `apps/wc2026-data/src/server.ts`

### Async-buildApp refactors (3 services)

`@fastify/swagger@9` only captures routes registered AFTER its onRoute hook is installed; the hook is installed only when `await app.register(swagger)` resolves. The three services with sync `buildApp(...)` had to become async so swagger could be awaited before route registration.

- `apps/clip-pipeline/src/api.ts`: `buildApp` is now `async function ... : Promise<FastifyInstance>`. swagger registered inline.
- `apps/social-publisher/src/server.ts`: same refactor.
- `apps/odds-ingest/src/api.ts`: same refactor.

Callers updated:

- `apps/clip-pipeline/{src/index.ts, test/api.test.ts, test/event-trigger.test.ts}`
- `apps/social-publisher/{src/index.ts, tests/server.test.ts, tests/healthz-adapter-modes.test.ts}`
- `apps/odds-ingest/{src/index.ts, test/api.test.ts}`

All test setup helpers that build an app are now `async function setup()`.

### Dependencies

`@fastify/swagger@^9.7.0` and `@fastify/swagger-ui@^5.2.6` added to all 15 Fastify services in `apps/*/package.json`. `pnpm-lock.yaml` updated.

### Top-level

- `README.md` — added a "Documentation" section linking to the new docs.
- `package.json` — added `dump-openapi` to the workspace recursive script.

### Service READMEs (cross-links)

Appended an "API reference" section linking the static spec + `docs/api/README.md` to:

- `apps/api/README.md`
- `apps/auth-sms/README.md`
- `apps/crm-bridge/README.md`
- `apps/identity/README.md`
- `apps/affiliate-router/README.md`
- `apps/drips-bridge/README.md`
- `apps/game/README.md`
- `apps/push-notifications/README.md`
- `apps/social-publisher/README.md`
- `apps/vstamp/README.md`
- `apps/clip-pipeline/README.md`
- `apps/odds-ingest/README.md`
- `apps/wc2026-data/README.md`

(`apps/dm-otp` and `apps/dm-poll-forwarder` have no README — left as-is per the convention "don't create READMEs unless asked".)

## Constraints honoured

- **`apps/game/src/server.ts`** was NOT modified per the brief — the per-match-pick-popup agent owns it. `apps/game/src/swagger.ts` is in place with a TODO comment for the orchestrator to wire `await registerSwagger(app)` once that PR lands. The dump script registers swagger out-of-band via `apps/game/scripts/dump-openapi.run.ts` so we still get a faithful spec today (10 paths captured).
- `apps/web/components/replay/`, `apps/web/lib/animation/`, `apps/web/components/overlay/`, `apps/web/components/match-pick/` — not touched.
- `packages/spec/` — not touched.

## Verification

- `pnpm typecheck` — clean for every app I touched (verified per-service):
  - api, auth-sms, crm-bridge, identity, dm-otp, dm-poll-forwarder, affiliate-router, drips-bridge, game, push-notifications, social-publisher, vstamp, clip-pipeline, odds-ingest, wc2026-data — all 0 errors.
- `pnpm test` — clean for every Fastify service I touched (133 tests in social-publisher, 102 in clip-pipeline, 49 in odds-ingest, etc.).
- All 15 OpenAPI dumps regenerate cleanly via `pnpm --filter <pkg> run dump-openapi`. Path counts:
  - api: 3, auth-sms: 9, crm-bridge: 11, identity: 8, dm-otp: 22, dm-poll-forwarder: 6, affiliate-router: 3, drips-bridge: 7, game: 10, push-notifications: 11, social-publisher: 3, vstamp: 7, clip-pipeline: 8, wc2026-data: 6, odds-ingest: 6.
- All committed JSONs validate as OpenAPI 3.0 (each has `openapi: '3.0.0'` and a non-empty `paths` map, except game which is also 10 paths via the out-of-band registration).

## Notable design decisions

- **vitest-driven dumps.** Workspace `.ts`-main packages (`@vtorn/spec`) don't resolve cleanly under tsx + Node 24's ESM loader without `"type": "module"` (which we don't add per the constraint). Vitest's transformer handles this correctly, so each service's `dump-openapi` script delegates to a vitest one-shot test that side-effects the spec to disk. Same pattern across all 15 services.
- **`as any` casts on swagger registration.** `@fastify/swagger@9` augments `FastifyInstance` without generic parameters, which conflicts with `@fastify/rate-limit@10`'s parametrised augmentation. The casts are confined to two lines in each `swagger.ts` (or the inline registration for the three async-buildApp services).
- **In-router swagger for clip-pipeline/social-publisher/odds-ingest.** These three had sync buildApp signatures using `void app.register(...)`. fastify-swagger's onRoute hook only fires on routes registered after the plugin resolves — so we had to switch them to async + `await` registration. This is the only way to capture every route in the spec.
- **Game's out-of-band registration.** Per the brief, do not touch `apps/game/src/server.ts`. Solution: the dump script builds a parallel Fastify instance, registers swagger first, then calls the same route registrar functions. Produces a faithful spec (10 paths) while leaving the real server untouched. Once the sibling PR lands, the orchestrator wires it directly.

## Next steps

- Once `feat/per-match-pick-popup` lands, orchestrator wires `await registerSwagger(app)` into `apps/game/src/server.ts` and removes the parallel-build kludge from the dump script.
- Tournament-bot is on Fastify v4. When it migrates to v5, add swagger there too — tracked in `IDEAS.md`.

## PR

`gh pr create --base main --title "docs: hive-mind index + glossary + playbook + Swagger/OpenAPI for every Fastify service"` — body matches this session note.
