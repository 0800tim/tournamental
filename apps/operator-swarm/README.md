# @tournamental/operator-swarm

PM2 and ops wrapper for running a federated Tournamental Bot Node at scale.

This app does not implement any bot logic itself. It wraps the
`tournamental-bot-node` CLI shipped by `@tournamental/bot-node` with the
production concerns a server admin actually needs: PM2 process management,
auto-restart, log rotation, credentials lifecycle, and a health-check probe.

Phase 1 use case: Tim runs one node on the Tournamental server itself,
operating roughly one million bots, so the public Bots leaderboard tab has
real activity from day one of the FIFA World Cup 2026. Phase 2 onwards, this
same app is the reference deployment external operators copy from.

## At a glance

| File                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `.env.example`             | All knobs, with sensible defaults for the 1M-bot demo.  |
| `scripts/register.sh`      | One-shot operator registration with the central API.    |
| `ecosystem.config.cjs`     | PM2 config, log paths, heap sizing, restart policy.     |
| `scripts/health-check.sh`  | Curls the local `/stats` endpoint and reports status.   |

## Prerequisites

- Node 20+ and pnpm 9+ on the host.
- PM2 installed globally or available via `pnpm exec` (the package pulls in
  PM2 as a devDependency, so `pnpm install` in the repo root is enough).
- The host user (here, `0800tim`) owns `~/.tournamental/` and the app
  directory.
- `@tournamental/bot-node` already built in the workspace. Run
  `pnpm --filter @tournamental/bot-node build` if in doubt.
- Outbound HTTPS to `api.tournamental.com` (or wherever
  `TOURNAMENTAL_API_BASE_URL` points).

## First-time deploy on the Tournamental server

These steps are written for the `0800tim` user on the prod box. Adjust paths
for your environment.

```bash
# 1. Pull the latest main and install the workspace.
cd /home/0800tim/tournamental
git fetch origin
git checkout main
git pull
pnpm install

# 2. Copy the env template and fill it in.
cd apps/operator-swarm
cp .env.example .env
$EDITOR .env
#   - confirm OPERATOR_EMAIL=info@tournamental.com
#   - keep OPERATOR_NODE_LABEL=tim-1m-demo (this is what shows on the
#     federated leaderboard column "node")
#   - confirm BOT_COUNT=1000000 (drop to 100000 for the smoke test first)
#   - leave STRATEGY=chalk for launch, swap later

# 3. Register the node with the central API.
pnpm run register
# Writes credentials to ~/.tournamental/operator.json (chmod 600).
# Idempotent: rerunning does nothing if credentials already exist.

# 4. Start the swarm under PM2.
pnpm run start

# 5. Confirm it is alive.
pnpm run status
pnpm run health

# 6. Survive a reboot. Run pm2 startup once and save the process list.
pm2 startup systemd -u 0800tim --hp /home/0800tim
pm2 save
```

After this, the bot node runs as a PM2-managed process and restarts on crash
or reboot. The federated leaderboard on
`https://play.tournamental.com/bots` lights up within a few minutes once the
first match commitment lands.

## Sizing guidance

The headline number for the launch demo is **1,000,000 bots**. The rest of
this section is the operator-facing version of what the design doc spells
out in detail.

| Bots       | Approx peak heap | Disk for local DB | Notes                                |
| ---------- | ---------------- | ----------------- | ------------------------------------ |
| 10,000     | ~150 MB          | ~50 MB            | Cheap laptop, useful for soak tests. |
| 100,000    | ~1.2 GB          | ~500 MB           | Small VPS box.                        |
| 1,000,000  | ~10 GB           | ~6 GB             | Tim's launch-day demo node.           |
| 10,000,000 | ~95 GB           | ~60 GB            | Single-box ceiling, needs swap care.  |
| 1,000,000,000 | shard across many nodes | shard | Aspirational Phase 2 federation.   |

Heap budget for the 1M-bot demo is set to 12 GB in `ecosystem.config.cjs`
(`--max-old-space-size=12288`), which gives roughly 2 GB headroom over the
observed peak. Bump to 24576 if the node ever OOM-kills under sustained
match traffic.

For larger fleets, shard horizontally: run multiple `operator-swarm`
instances, each with its own `OPERATOR_NODE_LABEL`, each registered as a
distinct node. The federated protocol expects this; do not try to push a
single PM2 process past about 2M bots.

Disk-wise, the local commitments DB grows ~6 GB per million bots over a
full 104-match tournament. Put `~/.tournamental/` on a disk with at least
20 GB free for the demo node.

## Operating the node

```bash
# Live status (PID, restarts, CPU, RSS).
pnpm run status

# Tail logs (ctrl-C to exit).
pnpm run logs

# Quick local health probe (also: --json, --quiet).
pnpm run health

# Reload after env changes (zero-downtime).
pnpm run reload

# Stop without deleting from PM2.
pnpm run stop

# Fully remove from PM2 (does not delete credentials).
pnpm run delete
```

Logs land in `apps/operator-swarm/logs/`. Two files,
`bot-node.out.log` and `bot-node.err.log`, both rotated by
`pm2-logrotate` once installed:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 14
```

The bot-node also exposes `/stats` on `127.0.0.1:${BOT_NODE_STATS_PORT}`
(default 4811). Bind to localhost only, expose via your reverse proxy if
you want a public health page. The `health-check.sh` script reads this
endpoint and surfaces:

- `bot_count` (how many bots this node operates)
- `bots_still_perfect` (how many bots have hit every match so far)
- `last_commit_at` (UTC timestamp of the last merkle commit)
- `last_commit_match` (the match ID that triggered it)
- `score_total` (sum across all bots, for the leaderboard sanity check)
- `uptime_seconds` (process uptime)

Wire it into Cloudflare healthchecks, cron, or systemd timers as your
monitoring stack requires. Exit codes: 0 healthy, 1 stale or unreachable,
2 missing tooling on the host.

## Monitoring at the swarm level

PM2 only sees process-level metrics. For the bot-level view (commit
cadence, perfect-bot survivors, score totals) the source of truth is the
`/stats` endpoint and, behind it, the central federated leaderboard on
`https://play.tournamental.com/bots`. Cross-check both during the launch
weekend.

If `bots_still_perfect` stays at the same value across consecutive
matches and no public match ended in a chalk upset, that is almost
certainly a bug in the strategy, not a heroic prediction streak.

## Troubleshooting

- **Registration fails with 401**: check `OPERATOR_EMAIL` matches an active
  contact and the central API is reachable. Delete
  `~/.tournamental/operator.json` before retrying.
- **PM2 reports continuous restarts**: tail `logs/bot-node.err.log`. The
  usual suspect is a missing credentials file or an exhausted heap; both
  are visible in the first 50 lines.
- **`/stats` returns 200 but `last_commit_at` never advances**: the local
  worker queue is wedged. `pnpm run reload` first; if that does not help,
  the central API may be rate-limiting your `node_id`, in which case look
  for `429` lines in the err log.
- **OOM kill at 1M bots**: bump `--max-old-space-size` in
  `ecosystem.config.cjs` and `pnpm run reload`. If the box itself is
  swapping, shard to two `OPERATOR_NODE_LABEL` instances instead.

## Security notes

- Credentials in `~/.tournamental/operator.json` are sensitive. The script
  chmods them to 600 on write; do not relax this.
- Never commit `.env`. The repo `.gitignore` already excludes it; the
  template `.env.example` is the only file in this app that goes to git.
- The bot-node `/stats` endpoint MUST stay bound to `127.0.0.1`. Exposing
  raw stats publicly leaks score deltas in real time, which competing
  operators can game.
- The audit constraints in the design doc (pre-kickoff merkle commit,
  OTS anchoring, independent verification) are enforced by the central
  API. This wrapper does not loosen any of them; it only schedules the
  work that the bot-node performs.

## References

- Design: `docs/superpowers/specs/2026-06-07-bot-arena-design.md` (especially
  Section 15, "Phase 2 design preview: federated compute network").
- Plan: `docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md`.
- The underlying runtime: `packages/bot-node` (CLI: `tournamental-bot-node`).
