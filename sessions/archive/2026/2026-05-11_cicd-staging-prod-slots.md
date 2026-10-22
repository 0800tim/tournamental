# 2026-05-11 — CI/CD with staging/prod build slots

agent: cicd-builder
status: complete
branch: feat/cicd-staging-prod-slots
worktree: /home/clawdbot/clawdia/projects/vtorn-cicd
refs:
  - a prior atomic-swap project's `publish.sh` (gold-standard reference)
  - docs/22-deployment-and-tunnels.md
  - CLAUDE.md (operational ground truth)

## Plan

Tim asked for a blue-green slot-swap atomic-swap deploy generalised across the ~22-app
monorepo. Requirements distilled from the prompt:

1. **Build slots** — staging slot (`*-staging`) builds while prod slot
   (`*-prod`) keeps serving. Same filesystem `mv` is the swap = ~instant.
2. **Smoke tests** before any swap. Throwaway server on a private port.
3. **PM2 reload** preferred (zero downtime); fall back to restart.
4. **Cache warm** post-swap; ~2-3s perceived blip is the worst case.
5. **Per-app** deploy entrypoints reusing shared primitives.
6. **Change-detection** — only build/deploy what changed.
7. **GH workflows** — build-and-deploy on push, promote-to-prod manual
   gated.
8. **Rollback** — keep one previous build (`*-prev`) for instant revert.
9. **Persistent caches** — `.next/cache`, pnpm store, tsc incremental.

## Architecture

```
infra/deploy/
├── lib/
│   ├── build-slots.ts      slot path/buildKind helpers
│   ├── swap.ts             atomic rename + rollback file
│   ├── smoke.ts            throwaway server + asserts
│   ├── pm2.ts              reload/restart with fallback
│   ├── cache-warm.ts       URL warmer
│   ├── lock.ts             file lock (flock-style)
│   ├── rollback.ts         prod ← prod-prev swap
│   ├── timings.ts          jsonl recorder
│   └── publish.ts          orchestrator (build → smoke → swap → reload → warm)
├── publish-all.ts          parallel multi-app driver
├── promote-to-prod.ts      staging → prod single command
├── pm2/
│   ├── staging.config.cjs  ecosystem file (per env)
│   └── production.config.cjs
└── __tests__/              vitest suite (~50 cases)

apps/<service>/.deploy/publish.ts     per-app entrypoint

.github/workflows/
├── build-and-deploy.yml    push to main / staging-* triggers
├── promote-to-prod.yml     manual workflow_dispatch (gated)
└── cache-warm.yml          scheduled edge cache warmer
```

## Key decisions

- **Same-host blue-green** (blue-green slot pattern) is the default. Multi-host swap is
  documented but deferred — Cloudflare-Tunnel ingress flip would be a v2.
- **Build kind** is enum: `next | astro | node | fastify`. Each defines its
  staging dir, prod dir, build cmd, start cmd. Lets `publish()` stay generic.
- **Concurrency cap** of 4 parallel app builds — protects RAM on the dev box.
- **No interactive secrets at deploy time.** Secrets come from `.env.<env>`
  files on the deploy host (loaded by PM2) and from GH Actions secrets in CI.
- **Change-detection** uses `git diff --name-only origin/main..HEAD` mapped
  through a regex of `apps/<name>/`. PR builds rebuild only changed apps.

## Time budget (target on the dev box, marketing app baseline)

- Astro full build (cached): ~6s
- Smoke (server boot + 3 asserts): ~5s
- Swap (mv): <100ms
- PM2 reload: ~2s
- Warm: ~2s
- **End-to-end one-app deploy: ~15-20s; perceived downtime 2-3s**

For full-monorepo (all 22 apps changed simultaneously):
- 22 builds × ~10s avg with concurrency 4 = ~60-70s build phase
- Smoke matrix in parallel ~10s
- Swap + reload sequenced: 22 × 3s = ~70s
- **End-to-end: ~3-4 minutes; perceived per-app downtime still 2-3s**

## Out of scope (parked)

- Multi-host blue-green via tunnel ingress flip (documented in design doc).
- Canary/percentage deploys (requires a router we don't have).
- Auto-rollback on metric regression (requires prod metrics ingestion).
- Native iOS/Android app pipelines (`apps/native` — separate workflow, future).

## Dependencies on other agents

- `feat/pr-triage-and-security-pipeline` owns `.github/workflows/pr-security.yml`
  and `CONTRIBUTING.md` etc — DO NOT touch.
- `feat/docs-hive-mind-and-swagger` owns `docs/playbook/`, `docs/api/`,
  `docs/glossary.md`, `docs/README.md` — DO NOT touch. We add `docs/cicd/`
  sibling and `docs/47-cicd-pipeline.md`.

## Outcome

Done. 75 vitest cases covering swap, smoke, lock, warm, pm2, change-detection,
timings, build-slots. Workspace typecheck + tests pass. Dry-run for
`marketing` and `marketing,api` end-to-end works. Promote-to-prod
dry-run with `--force-prechecks-skip` works.

### Shipped

- `infra/deploy/lib/`: build-slots, swap, smoke, pm2, cache-warm, lock,
  rollback, timings, publish (orchestrator), changed-apps, index.
- `infra/deploy/{publish-all,promote-to-prod}.ts` — top-level drivers.
- `infra/deploy/pm2/{staging,production}.config.cjs` — PM2 ecosystem
  files for marketing/web/api/game (others commented in for later).
- `apps/{marketing,web,api,game}/.deploy/config.json` — per-app deploy
  config.
- `infra/deploy/lib/config.schema.json` — schema for the config files.
- `infra/scripts/deploy/{publish,rollback}.sh` — one-line shell wrappers.
- `.github/workflows/{build-and-deploy,promote-to-prod,cache-warm}.yml`.
- `docs/47-cicd-pipeline.md` + `docs/cicd/01..04-*.md` runbooks.
- Top-level `package.json` scripts: `deploy:staging`, `deploy:promote`,
  `deploy:rollback`.
- `.gitignore` updated for slot dirs + env files.
- README updated with a "Deploys" section.
- `pnpm-workspace.yaml` adds `infra/deploy` to workspace.

### Time-to-deploy estimates (per docs/47-cicd-pipeline.md)

| Scenario                           | End-to-end | Perceived downtime |
| ---------------------------------- | ---------- | ------------------ |
| One-app deploy (astro/marketing)   | 15-20s     | ~2-3s              |
| One-app deploy (next/web, warm)    | 30-40s     | ~2-3s              |
| One-app deploy (fastify/api)       | 10-15s     | <1s w/ pm2 reload  |
| Full monorepo (4 apps, par=4)      | 60-90s     | 2-3s per app       |
| Full monorepo (12+ apps, par=4)    | 3-4 min    | 2-3s per app       |

### Blockers / things deferred

- **Multi-host blue-green**: documented but not implemented. Cloudflare API
  ingress flip is the v2 swap mechanism.
- **Real SSH deploy host**: workflows assume `DEPLOY_SSH_*` and `PROD_SSH_*`
  secrets exist in GH org settings; Tim needs to populate these before
  enabling the workflows for live runs.
- **Per-app incident flags**: today the flag is global. Per-app flags are
  a follow-up ticket.
- **`gc.sh`**: failed-slot pruning cron not yet written (mentioned in 02
  runbook).
- **`pre-launch syndicate signups gitignore` + `infra/scripts/deploy/gc.sh`**
  are TODOs called out in their respective runbooks.

### Concurrent-agent boundaries — observed

- Did NOT touch `.github/workflows/pr-security.yml` or any pr-security
  artefacts.
- Did NOT touch `docs/playbook/`, `docs/api/`, `docs/glossary.md`, or
  `docs/README.md`. Created sibling `docs/cicd/` and `docs/47-*.md`.
- Did NOT modify `packages/spec`.
- Did NOT modify any sibling agent zones.
