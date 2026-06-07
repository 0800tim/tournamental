# A8: operator-swarm scaffold

- **Task**: scaffold `apps/operator-swarm/` as the PM2 wrapper for Tim's 1M-bot
  federated swarm node so the Bots leaderboard tab is populated from day one
  of the WC 2026 launch on 11 June.
- **Status**: ready for review.
- **Refs**:
  - `docs/superpowers/specs/2026-06-07-bot-arena-design.md` (Section 15,
    federated compute network).
  - `docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md`.
  - Parallel agent: A3 (owns `packages/bot-node`, exposes the
    `tournamental-bot-node` CLI this app wraps).

## What landed

- `apps/operator-swarm/package.json` (private workspace package,
  `@tournamental/operator-swarm`, `workspace:*` dep on `@tournamental/bot-node`).
- `apps/operator-swarm/.env.example` with the six env vars in the brief plus
  two operational extras (`BOT_NODE_STATS_PORT`, `OPERATOR_CREDENTIALS_PATH`).
- `apps/operator-swarm/scripts/register.sh` (idempotent, sources `.env`,
  validates JSON output, chmods credentials 600).
- `apps/operator-swarm/ecosystem.config.cjs` (PM2 fork mode, 12 GB heap for
  1M bots, rotated logs to `logs/`, env-file loader baked in so PM2 picks up
  values without a dotenv runtime dep).
- `apps/operator-swarm/scripts/health-check.sh` (curls `/stats`, formats
  human / json / quiet output, flags stale commits > 1h).
- `apps/operator-swarm/README.md` (full deploy guide for the server admin,
  including sizing table, monitoring guidance, troubleshooting).
- `apps/operator-swarm/.gitignore` (logs, .env, pm2 dump).

## Key decisions

- **PM2, not systemd.** The brief explicitly asks for a PM2 ecosystem file
  and the rest of the Tournamental stack uses PM2 for long-running Node
  workloads. Systemd unit can be a follow-up if ops wants belt-and-braces.
- **Wrapper does no runtime logic.** All bot behaviour lives in
  `@tournamental/bot-node`. This keeps the security surface tiny.
- **Heap default 12 GB.** Sized for the documented ~10 GB peak at 1M bots
  with 2 GB headroom. README documents how to scale up or down.
- **Credentials in `~/.tournamental/operator.json`.** Outside the repo tree
  so a runaway `git clean` cannot nuke them. chmod 600 on first write.
- **Stats endpoint bound to localhost.** README explicitly warns about not
  exposing raw stats publicly (leaks competing-operator advantage).
- **No em-dashes / en-dashes in any file.** Grepped clean before commit per
  Tim's hard rule.

## Open questions for orchestrator / A3

1. Exact CLI flag names for `tournamental-bot-node`. I assumed
   `register --email --label --api-base-url` and
   `run --bots --strategy --stats-port --credentials --api-base-url --label`
   based on the spec language. If A3's actual CLI diverges, the
   ecosystem.config args list is the only place to update.
2. Default `/stats` port. I picked 4811 (4xx10 family, away from the
   producer's 4001). Happy to align with whatever A3 ships.
3. The plan lists `packages/bot-sdk` rather than `packages/bot-node` for
   the SDK / Swarm helper. I followed the brief and used
   `@tournamental/bot-node` as the wrapped runtime, on the assumption A3 is
   building the federated-node-grade variant that talks to
   `/v1/nodes/commit` and friends. Worth confirming.

## Verification

- `bash -n` on both shell scripts.
- `node -e` loads `ecosystem.config.cjs` cleanly; app entry name and arg
  count look correct.
- `JSON.parse` on `package.json` passes.
- Repo-wide grep for `—` / `–` returns nothing in this app.

## Next steps

- A3 ships `packages/bot-node` with the assumed CLI surface.
- Reviewer agent picks up the PR.
- On merge, Tim deploys following the README checklist and hits `pnpm run
  health` to confirm green before launch.
