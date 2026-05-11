# 02, Rollback runbook

> What rollback means in our build-slot model and when to invoke it
> manually.

## Auto-rollback (built into publish())

Triggered when the post-swap `verify` step gets a 5xx from the prod
healthz path. The publish() helper:

1. `mv .next-prod .next-failed`
2. `mv .next-prev .next-prod`
3. `pm2 reload <name>`

If steps 1–3 succeed, the deploy timing line records
`outcome: "rolled-back"` and the failing build sits in
`apps/<name>/.<kind>-failed/` for post-mortem.

If step 1 or 2 fails, the publish() helper records `outcome: "failed"`
and the operator has to recover manually (most likely: the prev slot
didn't exist, e.g. this was the first ever deploy of this app).

## Manual rollback

Use this when the deploy succeeded ostensibly but a real-world bug
surfaced minutes later.

```bash
ssh deploy@<host>
cd /opt/vtorn
pnpm --filter @vtorn/cicd-tools exec tsx -e '
  import { rollback } from "./infra/deploy/lib/rollback.js";
  await rollback({
    app: "marketing",
    appDir: "/opt/vtorn/apps/marketing",
    buildKind: "astro",
    pm2Name: "vtorn-marketing-prod",
    ecosystemFile: "/opt/vtorn/infra/deploy/pm2/production.config.cjs",
    repoRoot: "/opt/vtorn",
  });
'
```

(A small CLI wrapper at `infra/scripts/deploy/rollback.sh` is on the TODO.)

## When `.<kind>-prev` doesn't exist

You're in a corner, there's nothing to roll back to on disk. Two paths:

### 1. Rebuild from a previous good SHA

```bash
git checkout <good-sha>
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vtorn/cicd-tools run publish-all -- \
  --env=production --apps=<app>
```

This will go through the full build → smoke → swap flow with the old code.

### 2. Restore from the failed slot (last resort)

If the failed slot is somehow recoverable (e.g. you discover the bug was
in env config, not code):

```bash
mv apps/<name>/.next-failed apps/<name>/.next-prod
pm2 reload vtorn-<name>-prod --update-env
```

## Inspecting the failed slot

The failed slot has the full build output. You can boot a sidecar server
on a private port to repro:

```bash
cd /opt/vtorn/apps/<name>
NEXT_BUILD_DIR=.next-failed PORT=9999 npx next start --hostname 127.0.0.1 --port 9999
curl -v http://127.0.0.1:9999/api/healthz
```

## Cleanup

The failed slot is kept indefinitely until the next rollback overwrites
it. If disk pressure becomes a concern, the cron at
`infra/scripts/deploy/gc.sh` (TBD) can prune anything older than 14 days.

## Pre-deploy snapshots (optional)

For high-risk releases, snapshot the prod DB before deploying:

```bash
bash infra/scripts/db-backup.sh --tag pre-<sha>
# proceed with deploy
# if rollback needed, restore the snapshot:
# bash infra/scripts/db-restore.sh --from pre-<sha>
```

Schema migrations are forward-only (per `apps/<name>/migrations/`); the
DB snapshot is the only way to truly revert one. Avoid where possible.
