# ROADMAP

> Sprint shape. Updated by the orchestrator when scope shifts. Don't list everything — that's `BACKLOG.md`. List the things that matter for the next 2–3 weeks.

## Now (current sprint — week of 2026-05-09)

**Goal**: AR-FR 2022 World Cup Final replay running in a browser at `https://vtorn.aiva.nz`, end-to-end, with historic odds in the HUD.

| ID    | Item                              | Owner                | Status        |
| ----- | --------------------------------- | -------------------- | ------------- |
| #0001 | StatsBomb-replay producer (#3)    | agent:statsbomb-replay | in-progress   |
| #0002 | Renderer (#4)                     | agent:web             | in-progress   |
| #0003 | Avatar pipeline (#5)              | agent:avatar          | PR #10 open   |
| #0004 | Mock producer (#6)                | agent:mock-producer   | in-progress   |
| #0005 | Historic-odds HUD (#8)            | unstaffed             | inbox         |
| #0006 | AR-FR end-to-end smoke            | orchestrator          | blocked on #0001-#0004 |
| #0007 | Infra/conventions/DB/backups      | orchestrator          | PR #9 open    |
| #0008 | Project management board (this)   | orchestrator          | this PR        |
| #0009 | Gamification + virality strategy  | orchestrator          | doc-only this PR |

## Next (sprint after AR-FR demo lands)

**Goal**: predictions can be submitted and settled; admin dashboard shows it; analytics ingest is live.

| ID    | Item                              | Notes                                   |
| ----- | --------------------------------- | --------------------------------------- |
| #0010 | `apps/api/` Fastify skeleton      | `/v1/event` + auth scaffolding          |
| #0011 | Prisma schema + migrations        | users, predictions, events, tournaments |
| #0012 | `packages/analytics/` SDK         | GTM + sendBeacon, dataLayer events      |
| #0013 | `apps/admin/` MVP (#11)           | live + today + users + drilldown        |
| #0014 | Engagement scorer worker          | reads Redis stream, writes scores       |
| #0015 | Telegram bot                      | auth + push channel                     |
| #0016 | VStamp service                    | verifiable prediction receipts          |

## Later (Phase 3)

**Goal**: launch readiness — go-to-market motion, virality loops, on-chain pools.

- Tournament bracket UI.
- Auto-clip pipeline (per-goal short clips, captioned, branded, posted on TikTok / Instagram / X / YouTube Shorts).
- Bot persona policies live (lurker prompt / share prompt / VIP invite).
- Affiliate router + Polymarket/Bet365 integrations.
- TournamentalOracle audit + on-chain pool launch.
- ClickHouse warehouse migration.
- iOS / Android native shells (contacts integration for friend leaderboards).

## Definition of Done — current sprint

- [ ] AR-FR 2022 final replays in browser at `https://vtorn.aiva.nz` end-to-end.
- [ ] HUD shows live historic odds at every key moment.
- [ ] 30-second screen capture exists, watchable, shareable.
- [ ] All four builder PRs merged with the reviewer-agent checklist clean.
- [ ] CI green on every PR; DCO sign-off on every commit.
- [ ] Postgres + Redis up, backed up hourly, restorable.
- [ ] `tasks/` board reflects reality.
- [ ] `docs/` updated where designs shifted (per CLAUDE.md rule).
- [ ] No regressions to existing infra (clawdia services unchanged).
