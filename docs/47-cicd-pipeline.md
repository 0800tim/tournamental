# 47, CI/CD pipeline (build slots, atomic swap, fast rebuilds)

> The deploy strategy across the Tournamental monorepo. Generalises the prior project's
> `publish.sh` into a typed, tested, monorepo-aware library + per-app
> entrypoints + GH Actions workflows.

This doc is the architecture; the runbooks at [docs/cicd/](cicd/) cover the
operator-facing procedures.

## Goals

1. **Tiny perceived downtime.** Same-host blue-green slot swap. Worst-case
   ~2-3 seconds during `pm2 reload` (often less with cluster mode).
2. **Smoke before swap.** No prod traffic ever sees a build that didn't pass
   smoke tests.
3. **Fast rebuilds.** Persistent caches between builds so a one-line typo
   fix takes seconds, not minutes.
4. **Multi-app aware.** Only build/deploy what changed, in parallel.
5. **Cheap rollback.** One previous build kept around; rollback is another
   atomic swap.

## High-level flow

```
                      ┌──────────────────┐
                      │  push to main    │
                      └────────┬─────────┘
                               │
                               ▼
            ┌───────────────────────────────┐
            │   .github/workflows/          │
            │   build-and-deploy.yml        │
            └───────┬───────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   detect-changes          build matrix
   (git diff →              (per app, with
    apps[])                 persistent .next/cache)
        │                       │
        └───────────┬───────────┘
                    ▼
              test matrix
                    │
                    ▼
        deploy-staging (SSH to host)
                    │
                    ▼
          publish-all --env=staging
                    │
            (per-app publish() runs:)
            ┌──────┴──────┐
            ▼             ▼
       acquire lock   build → staging slot
                          │
                          ▼
                   smoke test on :30xx
                          │
                          ▼
                  atomic swap prod ← staging
                          │
                          ▼
                  pm2 reload <name>
                          │
                          ▼
                  verify /healthz on :port
                          │
                          ▼
                  cache warm (gzip+br)
                          │
                          ▼
                  release lock + record timings


    ┌───────────────────────────────────────────────────┐
    │  human invokes promote-to-prod.yml on success     │
    │  (gated on PROD_DEPLOYERS_LIST)                   │
    │      → publish-all --env=production                │
    └───────────────────────────────────────────────────┘
```

## Slot strategy

For each app we maintain four directories on the deploy host:

```
apps/<name>/
  ├── .next-prod      (or dist-prod for astro/fastify)   ← live; pm2 reads here
  ├── .next-prev      ← previous build; rollback target
  ├── .next-staging   ← built fresh per deploy; smoke runs here
  └── .next-failed    ← post-rollback quarantine for inspection
```

The "swap" is `mv` on the same filesystem, which is atomic at the
directory-entry level. PM2 doesn't restart on the swap (it's unaware); we
restart/reload PM2 explicitly *after* the swap so it picks up the new slot.

## Why not a containerised blue-green?

Two reasons:

1. **Speed.** A `mv` on the same fs is sub-100ms; a container build + pull
   is minutes.
2. **Single-host pragmatism.** The dev box runs everything; we don't have
   a load balancer in front yet. When we add one (Cloudflare Tunnel
   ingress flip), this same library will support multi-host blue-green by
   adding a `--host` flag, design space documented in
   [docs/cicd/01-deploy-runbook.md](cicd/01-deploy-runbook.md).

## Cache strategy

Three caches feed the speed promise:

1. **GH Actions cache**, keyed on `pnpm-lock.yaml` + the app's source-tree
   hash. Holds `.next/cache`, `node_modules/.cache`, `.astro`,
   `dist/.tsbuildinfo`. Restore-keys fall back to lockfile-only matches so
   even a fresh app benefits.
2. **pnpm content store**, `pnpm install --frozen-lockfile --prefer-offline`
   guarantees we never re-resolve, only fetch missing tarballs (usually zero
   on a warm runner).
3. **In-process incremental**, Next's incremental compile is preserved
   between builds because we always build to the *same* staging dir
   (`.next-staging`) which retains `.next-staging/cache` between runs.

For Fastify Node services, `tsc -b --incremental` writes
`dist/.tsbuildinfo` which the persistent GH cache hangs onto.

## Change-detection

`infra/deploy/lib/changed-apps.ts` maps a git diff to a set of apps:

| Path pattern                    | Effect                          |
| ------------------------------- | ------------------------------- |
| `apps/<name>/...`               | rebuild that app                |
| `packages/<name>/...`           | **rebuild ALL apps** (consumers unknown) |
| `pnpm-lock.yaml`                | rebuild ALL apps                |
| `tsconfig.base.json`            | rebuild ALL apps                |
| `infra/deploy/...`              | rebuild ALL apps                |
| `docs/...`, `sessions/...`      | no-op                           |

The CI workflow uses the same logic via a one-liner that imports the lib -
so local-vs-CI behaviour is identical.

## Per-app config

Every deployable app has `apps/<name>/.deploy/config.json`:

```json
{
  "buildKind": "next",
  "port": 3300,
  "smokePort": 3097,
  "healthzPath": "/api/healthz",
  "smoke": [
    { "url": "/api/healthz", "label": "health", "maxMs": 1500 }
  ],
  "cacheWarm": ["/", "/world-cup-2026"],
  "warmBase": "https://app.tournamental.com"
}
```

`buildKind` is one of `next | astro | node | fastify`. The publish() helper
picks the right build/start/smoke commands and slot prefixes.

## Time budget (measured against the dev box)

| Scenario                           | Expected end-to-end | Perceived downtime |
| ---------------------------------- | ------------------- | ------------------ |
| One-app deploy, marketing (astro)  | 15-20s              | ~2-3s              |
| One-app deploy, web (next, warm)   | 30-40s              | ~2-3s              |
| One-app deploy, api (fastify)      | 10-15s              | <1s with reload    |
| Full monorepo (4 apps, par=4)      | 60-90s              | 2-3s per app       |
| Full monorepo (12+ apps, par=4)    | 3-4 min             | 2-3s per app       |
| Cold-cache rebuild (drop GH cache) | 2× warm-build time  | unchanged          |

PM2 cluster-mode apps (web, api, game) reload with **zero** downtime -
PM2 brings up new workers, drains old ones, swaps. The 2-3s figure is the
worst case (fork-mode astro/marketing).

## Rollback

```bash
pnpm --filter @vtorn/cicd-tools exec tsx infra/deploy/lib/rollback.ts \
  --app=marketing --buildKind=astro
```

Internally:
1. `mv .next-prod .next-failed`
2. `mv .next-prev .next-prod`
3. `pm2 reload <name>`

If `.next-prev` doesn't exist, you can't auto-rollback; `git checkout
<previous-sha> && publish` is the manual path.

## Env config flow

- **Dev**: `apps/<name>/.env`, gitignored, hand-managed.
- **Staging**: `apps/<name>/.env.staging`, on the deploy host, populated
  from a secret store (1Password / Vault / `pass`, TBD).
- **Production**: `apps/<name>/.env.production`, same.

PM2 ecosystem files (`infra/deploy/pm2/<env>.config.cjs`) reference these
files via `env_file`. PM2 doesn't natively support env_file, so the
ecosystem file shells out via `node --require dotenv/config` for affected
apps where this matters; for now, `pm2 reload --update-env` re-reads the
`.env.<env>` files via the start script's own dotenv loader.

Secrets rotation: see
[docs/cicd/04-secrets-rotation-runbook.md](cicd/04-secrets-rotation-runbook.md).

## Observability

Every deploy step appends a JSONL line to `data/deploy-timings.jsonl`:

```json
{"app":"marketing","env":"staging","startedAt":"2026-05-11T03:42:00Z",
 "finishedAt":"2026-05-11T03:42:18Z","durationMs":18000,
 "steps":[{"name":"build","durationMs":6000,"ok":true},
          {"name":"smoke","durationMs":4500,"ok":true},
          {"name":"swap","durationMs":40,"ok":true},
          {"name":"pm2","durationMs":2100,"ok":true},
          {"name":"verify","durationMs":1500,"ok":true},
          {"name":"warm","durationMs":3800,"ok":true}],
 "outcome":"success","buildId":"abc123"}
```

This is the source for the deploy-history widget (forthcoming) and the
"what's normal" baseline in the runbook.

## Multi-host blue-green (deferred)

When we move staging and prod to separate hosts, the "swap" expands:

1. Both hosts run their own per-app prod slot.
2. Cloudflare Tunnel ingress for the prod hostname points at the
   currently-active host.
3. "Promote" = call the Cloudflare API to flip ingress. Same atomic
   feel; the previous host stays warm as the rollback target.

This needs a Cloudflare-API helper similar to
`infra/scripts/cf-add-tournamental-hosts.sh`. Out of scope for the first PR.

## Failure modes and recovery

| Failure                  | Outcome           | Recovery                     |
| ------------------------ | ----------------- | ---------------------------- |
| `pnpm install` fails     | build job fails   | inspect lockfile / cache key |
| `pnpm build` fails       | build job fails   | local repro                  |
| Smoke test fails         | abort, no swap    | inspect smoke log; fix       |
| Swap fails post-rotation | restore prev→prod | manual                       |
| PM2 reload hangs         | timeout in lib    | `pm2 restart` manually       |
| Verify fails (5xx)       | auto-rollback     | inspect `.next-failed/`      |
| Cache warm slow          | non-fatal warning | investigate CDN / origin     |
| Lock contention          | wait up to 60s    | other deploy will finish     |

## Related docs

- [docs/22-deployment-and-tunnels.md](22-deployment-and-tunnels.md) -
  ports, hostnames, Cloudflare Tunnel.
- [docs/25-keys-and-secrets-required.md](25-keys-and-secrets-required.md) -
  what env vars each service needs.
- [docs/cicd/01-deploy-runbook.md](cicd/01-deploy-runbook.md) -
  step-by-step deploy.
- [docs/cicd/02-rollback-runbook.md](cicd/02-rollback-runbook.md) -
  when and how to roll back.
- [docs/cicd/03-incident-flag-runbook.md](cicd/03-incident-flag-runbook.md) -
  halting promotes during an incident.
- [docs/cicd/04-secrets-rotation-runbook.md](cicd/04-secrets-rotation-runbook.md) -
  rotating env secrets without downtime.
