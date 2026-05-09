# 2026-05-09 — orchestrator — phase-1-infra

**Status**: in-progress

**PRs**:
- #7 (merged, `91d9ca5`) — `ci: add baseline GitHub Actions pipeline`
- _open_ — `chore/infra-conventions` branch (this session's main artifact)

## Goal

Stand up everything around the four parallel builder agents so they have working CI, caching/performance discipline, a database stack to point at, and the dev tunnels they need to demo their work to Tim. Tim is AFK — full autonomy on infra decisions.

## Reading

- `STARTER-PROMPT.md` — original orchestrator brief (still valid).
- Earlier session note `sessions/2026-05-09_orchestrator_phase-0.md` — Phase 0 outcome.
- `clawdia/CLAUDE.md` (parent project) — for "don't touch working infra" rule and the Cloudflare-tunnel-is-remotely-managed note.
- `/etc/cloudflared/config.yml` — live tunnel config (turns out NOT remotely managed; the local file is authoritative).

## Plan

1. ✅ Land CI workflow (PR #7).
2. ✅ Open issue #8 — historic-odds HUD (tight scope).
3. ✅ Dispatch four builder agents in parallel worktrees (background).
4. ✅ Wire `vtorn.aiva.nz`, `vtorn-stream.aiva.nz`, `vtorn-api.aiva.nz`, `vtorn-www.aiva.nz` ingress on the existing aiva.nz tunnel.
5. ⏳ Stand up Postgres 16 + Redis 7 dev stack via Docker Compose (volumes, healthchecks, sane resource limits for 6.5GB box).
6. ⏳ Backup discipline: `db-backup.sh` (hourly/daily/weekly rotation, sha256 verified, offsite-ready) + `db-restore.sh` (host-allowlisted, optional PII scrub).
7. ⏳ Update `CLAUDE.md` with performance & caching review checkpoints, port table, environment plan.
8. ⏳ Dependabot config (weekly minor/patch updates for npm, gh-actions, pip).
9. ⏳ `apps/api` Fastify skeleton (separate PR after this one merges).
10. ⏳ Watch builder PRs as they roll in; merge after self-review.
11. ⏳ Run AR-FR integration smoke once all four builder PRs merge.

## Decisions

- **Database choice: Postgres + Redis (not NoSQL).** *Why*: prediction integrity needs ACID; user accounts and affiliate accounting need transactions; relational + JSONB covers our flexibility needs without DynamoDB's quirks. Redis covers hot leaderboards (sorted sets), session cache, pub/sub, and an LRU layer in front of Postgres for the hottest reads. Tim confirmed mid-session.
- **In-memory cache layer added to the stack** *Why*: per-process LRU sits in front of Redis for the hottest items (leaderboard top-10, current-match summaries). Confirmed by Tim. Documented in `docs/22-deployment-and-tunnels.md`.
- **Postgres 16 with `--data-checksums` and tuned shared_buffers/effective_cache_size for a 6.5GB host.** *Why*: detect silent corruption early; tuning prevents the OOM/swap loop a vanilla container hits when the JIT planner gets aggressive.
- **Three-environment plan: dev (aiva.nz subdomains, this server) → staging (`*.vtorn.com` "dev/preview/api-dev") → prod (`vtorn.com`, `app.vtorn.com`, `api.vtorn.com`).** *Why*: Tim's request mid-session. Documented end-to-end in `docs/22-deployment-and-tunnels.md`. Production CNAMEs wait until vtorn.com is in his Cloudflare account.
- **Ports allocated in the 33xx + 4001 range.** *Why*: avoids clashing with clawdia (3001, 5433, 6379, 8888, 9201–9274). Producer WS stays on 4001 to match `docs/05-mock-producer.md` which is already authoritative.
- **Cloudflare tunnel is locally configured at `/etc/cloudflared/config.yml`, NOT remotely managed.** *Why*: my memory note from the clawdia project said remote-managed. Verified by reading the live systemd unit — it runs `cloudflared --config /etc/cloudflared/config.yml tunnel run`. Local file is the source of truth. Updated my mental model and these session notes; the relevant clawdia memory should be updated separately.
- **Backups: tiered hourly/daily/weekly with sha256 verification, plus optional `VTORN_BACKUP_OFFSITE_DIR` for the weekly archive.** *Why*: hourly catches "I just dropped a table" within an hour; daily covers most rollback windows; weekly is the offsite-friendly archive. sha256 sidecar lets restore pre-flight integrity check without re-reading the dump.
- **Restore script refuses to run on non-localhost hosts unless `VTORN_RESTORE_FORCE=1`.** *Why*: stop the most common production-data-foot-gun (running `db-restore.sh ... prod.dump` while pointed at a prod cluster). Allowlist via env, force-flag for genuine cross-env cases, PII scrub via `infra/db/pii-scrub.sql` for prod-into-lower-env restores.

## Open questions / blockers for Tim

- **vtorn.com Cloudflare** — Tim said he'll set this up under his account. When done, I'll add the staging + prod tunnels. Until then, dev only.
- **Offsite backup target** — `VTORN_BACKUP_OFFSITE_DIR` is a hook; needs an rclone mount or S3/R2 bucket pointed at it. I'll wire one in once Tim picks the storage provider.
- **API surface** — `apps/api` skeleton lands as a separate PR. The actual auth/predictions/leaderboards endpoints are Phase 2 work; this PR sets up the Fastify shell at port 3310 with `/health` so the tunnel works end-to-end.

## Outcome (rolling)

What's landed (or merged) this session:

- **Issue #8** — Builder: HUD — historic odds for AR-FR 2022 demo.
- **PR #7** — `ci: add baseline GitHub Actions pipeline` (`91d9ca5`).
- **Tunnel routes** — `vtorn.aiva.nz`, `vtorn-stream.aiva.nz`, `vtorn-api.aiva.nz`, `vtorn-www.aiva.nz` all live, returning expected `HTTP/2 404` until the local services bind. Confirmed via `curl -sI`.
- **Builder agents** — four background subagents working in isolated worktrees on issues #3, #4, #5, #6.

What's pending in this PR (chore/infra-conventions):

- `docs/22-deployment-and-tunnels.md` — environment plan, URL plan, port table, caching strategy, daily review checklist.
- `CLAUDE.md` updates — performance/caching review section + port quick-reference table + DB stack pointer.
- `infra/docker/compose.yml` + `postgres-init/01-extensions.sql`.
- `infra/scripts/{db-up,db-down,db-backup,db-restore}.sh`.
- `.env.example` covering DB, Redis, API, renderer.
- `.github/dependabot.yml` (npm + gh-actions + pip-for-statsbomb-replay, weekly).

Tests: no new test code in this PR (infra/docs only). CI's existing checks must pass.

## Refs

- `docs/22-deployment-and-tunnels.md` (NEW)
- `infra/docker/compose.yml` (NEW)
- `infra/scripts/*.sh` (NEW)
- `.github/dependabot.yml` (NEW)
- IDEAS.md additions: none yet (will park "production tunnel setup when vtorn.com is in Cloudflare" if it doesn't ship within this sprint)
- Related sessions: `sessions/2026-05-09_orchestrator_phase-0.md`
