# 01 — Deploy runbook

> Operator-facing. How to deploy a change end-to-end, and what to do when
> something looks wrong.

## TL;DR — happy path

1. Open a PR against `main`. CI runs build + test.
2. Reviewer agent approves; merge.
3. `build-and-deploy.yml` triggers: builds changed apps, smoke-tests,
   atomic-swaps the staging slots, reloads PM2, warms cache. **End-to-end
   ~20-90s** depending on the diff.
4. Validate on `https://*.staging.vtourn.com`.
5. When ready, manually trigger `promote-to-prod.yml` via the GH Actions
   UI. Same flow runs against the prod host.

## Manual single-app deploy (from a laptop, against the deploy host)

Used when CI is unavailable or you want to deploy a side branch.

```bash
ssh deploy@<host>
cd /opt/vtorn
git fetch && git checkout <ref>
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vtorn/cicd-tools run publish-all -- \
  --env=staging --apps=marketing --concurrency=1
```

To go straight to prod (only when staging has already validated this SHA):

```bash
pnpm --filter @vtorn/cicd-tools exec tsx infra/deploy/promote-to-prod.ts \
  --apps=marketing
```

## Dry-run

The `--dry-run` flag prints what *would* happen and skips every mutation
(no build, no swap, no PM2). Useful for the first time you wire a new
app's `.deploy/config.json`.

```bash
pnpm --filter @vtorn/cicd-tools run publish-all -- \
  --env=staging --apps=marketing --dry-run
```

Expected output ends with `[8/8] DONE marketing` and the timings JSONL
gets a `success` line with all steps marked `ok: true` (since the dry-run
short-circuits each step before it can fail).

## What's "normal"?

From `data/deploy-timings.jsonl` baselines, a healthy deploy looks like:

| Step    | astro/marketing | next/web | fastify/api |
| ------- | --------------- | -------- | ----------- |
| build   | 4-8s            | 30-60s   | 3-6s        |
| smoke   | 4-6s            | 6-10s    | 2-4s        |
| swap    | <100ms          | <100ms   | <100ms      |
| pm2     | 2-3s            | 1-3s     | 1-2s        |
| verify  | 1-3s            | 1-3s     | <1s         |
| warm    | 2-5s            | 3-8s     | <1s         |

If a step takes 3× the baseline, investigate. The most common culprit is
a cache miss (rebuilt without `.next/cache`, or a cold pnpm store).

## Troubleshooting

### Smoke fails

The publish script prints `[smoke] FAIL <label>  expected 200, got 503`
and aborts before swapping. Prod was never touched.

Steps:
1. Open the smoke server's stderr log on the deploy host
   (`/tmp/<app>-smoke.log`).
2. Reproduce locally with `pnpm --filter @vtorn/<app> run start` against
   the staging slot.
3. Fix and push.

### Verify fails after swap

Auto-rollback should fire. Check `data/deploy-timings.jsonl` for an entry
with `outcome: "rolled-back"`. The failing build is in
`apps/<name>/.next-failed/` for inspection.

If auto-rollback also fails:
```bash
pnpm --filter @vtorn/cicd-tools exec tsx infra/deploy/lib/rollback-cli.ts \
  --app=<name>
```

### PM2 hangs

Two minutes is the lib's reload timeout. If exceeded, `publish()` falls
back to `pm2 restart` (~3s blip). If even that hangs, stop the publish
and run:

```bash
pm2 list
pm2 stop <name>
pm2 delete <name>
pm2 start infra/deploy/pm2/<env>.config.cjs --only <name>
```

### Lock held

`acquireLock: lock held at /tmp/vtorn-deploy-locks/<app>.lock` — another
deploy is running. Wait or check `cat /tmp/vtorn-deploy-locks/<app>.lock`
to see whose PID. If the PID is dead the next deploy will steal the lock
automatically.

## Multi-host (forward-looking)

When prod is on a separate host:

1. Push to main; staging deploys as today.
2. Tim or a deployer triggers `promote-to-prod.yml`. The workflow SSHes
   to the prod host and runs the same `publish-all --env=production`.
3. *Or* (planned): the workflow flips Cloudflare-Tunnel ingress so the
   `app.vtourn.com` hostname routes to the staging host. The instant
   ingress flip becomes the swap. Documented in
   [docs/47-cicd-pipeline.md](../47-cicd-pipeline.md).

Prerequisites still TBD:
- A second deploy host provisioned identically (PM2 + node + pnpm).
- Cloudflare API helper that PUTs ingress rules atomically.
- Health-check probe from the workflow before flipping.
