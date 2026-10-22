# 2026-08-12 — Tournamental Agent — restore WC2026 stack on clawdia (new box)

status: done (DNS cutover pending, Tim's call)

## Task

Old prod server died; full salvage at /data/clawdia-archive. Bring the
WC2026 app stack up on this box against the recovered production
game.db, as systemd user units, with tunnel ingress pre-staged.

## What was done

- Recovered prod env files from the archive's secrets sweep
  (secrets-os-disk.tgz, old checkout `projects/vtorn/`) into
  `apps/{game,web,admin,auth-sms,odds-ingest,tournament-bot,wc2026-data,api,news-aggregator}/`
  plus root `.env`, with `/home/clawdbot/clawdia/projects/vtorn` paths
  rewritten to `/srv/projects/internal/tournamental`. All gitignored.
- Restored SQLite data:
  - `apps/game/data/game.db` from the blessed archive copy — verified
    integrity ok, 208 users / 163 brackets / 22 syndicates /
    104 match results / 3246 swarm claims.
  - `apps/auth-sms/data/{auth.db,audit/,baileys/}`,
    `apps/odds-ingest/data/odds-ingest.sqlite`,
    `apps/tournament-bot/tg.db` from the mounted old OS disk
    (/mnt/old-os), WAL-checkpointed after copy.
- No Postgres/Redis: verified none of the prod stack uses them (all
  SQLite). The vtorn Postgres was empty its whole life; left down.
- pnpm 11 migration fixes (uncommitted, in working tree):
  - `pnpm-workspace.yaml`: filled the placeholder `allowBuilds` entries
    (swc/esbuild/sharp/better-sqlite3/protobufjs/unrs-resolver),
    `blockExoticSubdeps: false` (baileys pulls a git-resolved
    eslint-config subdep), migrated root `pnpm.overrides` +
    `onlyBuiltDependencies` from package.json (ignored by pnpm 11).
  - `apps/web/package.json`: added `sharp` — imported by two API routes
    but never declared; pnpm 11 stopped hoisting it and `next build`
    failed.
- Built and started everything as systemd user units (logs in
  `~/logs/tournamental/`), mirroring the old pm2 dump's exec patterns
  (game/auth-sms/tournament-bot run tsx-from-source, per their
  start.sh; web/admin are `next start`):

  | unit | port | old pm2 name |
  |---|---|---|
  | tournamental-game | 3360 | vtorn-game-prod |
  | tournamental-web | 3300 | vtorn-web-prod |
  | tournamental-admin | 3340 | vtorn-admin-prod |
  | tournamental-auth-sms | 3330 | vtorn-auth-sms |
  | tournamental-odds-ingest | 3341 | odds-ingest |
  | tournamental-tournament-bot | (polling) | vtorn-tournament-bot |
  | tournamental-espn-poller.timer | 1/min oneshot | vtorn-espn-poller |

- Smoke-tested: game /healthz 200 and serving the restored leaderboard,
  web / and /world-cup-2026 200, admin /login 200, auth /health 200,
  odds /healthz 200, poller runs and exits "no fixtures in window"
  (tournament ended 2026-07-19 — correct).
- Tunnel: added play/app/wc2026/2026wc/game/admin/auth/odds
  .tournamental.com ingress to ~/.cloudflared/config-tournamental.yml
  (above the 404 catch-all), validated, restarted
  tournamental-tunnel.service. Marketing site unaffected.
- DNS NOT touched: those hostnames still CNAME the dead tunnel.
  Cutover = repoint CNAMEs to
  a8769c80-e0f4-497d-bd7e-3bd79baed480.cfargotunnel.com (runbook in the
  hivemind: runbooks/tournamental-dns-cutover.md). Tim decides when.

## Next steps

- Tim: flip DNS per the runbook when ready to go live.
- Commit the pnpm-workspace.yaml + apps/web sharp changes via a proper
  branch/PR (left uncommitted; this box's install needs them).
- Not restored (weren't in the final pm2 stack): apps/api, mcp, news,
  stream hostnames have no local service; add ingress+units if revived.
- Rotate the old root-.env POSTGRES/REDIS passwords if those services
  are ever stood up again (values from the archive; treat as burned).
