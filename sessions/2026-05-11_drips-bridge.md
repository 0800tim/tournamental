# 2026-05-11 — drips-bridge initial build

**Agent**: drips-bridge builder
**Branch**: `feat/drips-bridge`
**Status**: complete (PR open)

## Task

Build `apps/drips-bridge/` — VTourn's Drips Network bridge for contributor
revenue sharing. Apache-2.0 + the pitch say contributors share platform
revenue via Drips, but there's been no service to host the registry or the
distribution lifecycle. This v0.1 puts the scaffolding in place with a mock
Drips client; mainnet is audit-gated.

## Plan

1. Worktree off `origin/main` so other agents (web/marketing/mobile/social)
   can keep editing concurrently.
2. Fastify service on `:3399`, mirror the affiliate-router pattern that's
   already in the repo (helmet + cors + sensible + admin secret header).
3. Domain model:
   - `Contributor`: id, githubLogin, ethAddress?, displayName, joinedAt, role,
     activeShares.
   - `RevenueDistribution`: id, period (YYYY-MM), totalReceiptsUsd, splits[],
     createdAt, status (pending → pushed → confirmed), txHash?
4. JSONL append-only persistence; replay rebuilds memory state on boot;
   corrupt lines skipped defensively.
5. Drips adapter with `mock` (default, deterministic SHA-256 pseudo-tx hashes)
   and `real` (stub that throws on sign). `payoutsToWeights` maps USD → Drips'
   1e6 basis-point resolution.
6. Routes: register/patch/list contributors, create/push/get distributions.
7. Auth: `x-drips-admin: <secret>` header on every write + the contributor
   listing route.
8. Tests covering the requested surface area.

## Decisions

- **Append-only JSONL over SQLite**: prompt asked for JSONL specifically; it
  also doubles as the audit log without extra effort. Round-trip tests cover
  insert + patch + status replay.
- **Splits maths uses `round2dp` + reconciles remainder onto the largest-share
  contributor** so `Σ payouts == totalReceiptsUsd` exactly. Same trick used
  again for `payoutsToWeights` so weights sum to exactly `1_000_000`.
- **Push refuses on missing eth address** — return 409 rather than partial-pay
  the rest. Avoids surprising "where's my $ ?" tickets later.
- **`RealDripsClient` constructor accepts the env it would need but `setSplits`
  / `pushPayout` throw with `audit-gated` in the message.** This enforces the
  audit gate in code, not just docs.
- **Service version exposed at `/v1/version`** so a future admin dashboard can
  display backend mode + version without scraping `/healthz`.

## Quality gates run

- `pnpm --filter @vtorn/drips-bridge typecheck` → clean.
- `pnpm --filter @vtorn/drips-bridge test` → **70/70 pass**.
- `pnpm --filter @vtorn/drips-bridge build` → clean (tsc emits to `dist/`).
- `pnpm typecheck` (workspace) → clean across all apps.

## Files added

- `apps/drips-bridge/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
- `apps/drips-bridge/src/server.ts`
- `apps/drips-bridge/src/context.ts`
- `apps/drips-bridge/src/lib/contributors.ts`
- `apps/drips-bridge/src/lib/drips-client.ts`
- `apps/drips-bridge/src/routes/health.ts`
- `apps/drips-bridge/src/routes/admin.ts`
- `apps/drips-bridge/src/routes/contributors.ts`
- `apps/drips-bridge/src/routes/distributions.ts`
- `apps/drips-bridge/tests/contributors.test.ts`
- `apps/drips-bridge/tests/persistence.test.ts`
- `apps/drips-bridge/tests/drips-client.test.ts`
- `apps/drips-bridge/tests/server.test.ts`
- `apps/drips-bridge/tests/setup.ts`
- `docs/40-drips-network-integration.md`

## Test counts

- contributors.test.ts — 23 tests (registry, splits maths, period validation)
- persistence.test.ts — 6 tests (JSONL round-trip, corrupt-line resilience)
- drips-client.test.ts — 17 tests (mock + real audit gate + weights helper)
- server.test.ts — 24 tests (all routes, admin enforcement, lifecycle)
- **Total: 70 tests**

## Next steps

- Wire `pnpm-lock.yaml` regen into the CI on the orchestrator's side.
- Add Cloudflare tunnel ingress for `drips.tournamental.com → :3399` once the
  PR merges (per docs/22 conventions).
- Per-PR review checklist: confirm no real on-chain writes added until audit.
- Follow-ups in docs/40 — idempotent push, USD→ETH oracle, multi-period
  batches, eligibility policy, receipts ingestion.

Refs: docs/40-drips-network-integration.md, AGENT-PROMPTS.md, README.md,
VTourn Pitch.md.
