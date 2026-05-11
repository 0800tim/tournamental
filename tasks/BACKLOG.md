# BACKLOG

> The everything list. One line per item. Higher priority at the top of each section. When a task gets pulled into the current sprint, promote it to a full task file in `tasks/inbox/` (or directly to `tasks/in-progress/` if it's being picked up).
>
> Items here that have a `[#NNNN]` prefix already have a task file with that ID; the BACKLOG line is just a short summary that links back. Items with `[?]` haven't been turned into task files yet — when promoted, allocate the next ID.

## P0 — must-ship for the AR-FR demo

- `[#0001]` AR-FR 2022 producer (`apps/statsbomb-replay/`) — gh issue #3 — agent in flight.
- `[#0002]` Renderer (`apps/web/`) — gh issue #4 — agent in flight.
- `[#0003]` Avatar pipeline (`packages/avatar/`) — gh issue #5 — PR #10 open.
- `[#0004]` Mock producer (`apps/mock-producer/`) — gh issue #6 — agent in flight.
- `[#0005]` Historic-odds HUD — gh issue #8 — unstaffed (post-renderer).
- `[#0006]` AR-FR end-to-end smoke — depends on #0001–#0004.

## P1 — next sprint (Phase 2 lanes)

- `[#0010]` `apps/api/` Fastify skeleton — `/health`, `/v1/version`, `/v1/event` ingest, CORS, rate-limits, JWT auth scaffolding.
- `[#0011]` Postgres schema migrations (Prisma) for `users`, `accounts`, `predictions`, `tournaments`, `events`, `bot_outreach`.
- `[#0012]` `packages/analytics/` SDK — GTM dataLayer + sendBeacon to `/v1/event`.
- `[#0013]` `apps/admin/` admin dashboard MVP — gh issue #11 — unstaffed.
- `[#0014]` Engagement scorer worker — `apps/engagement-scorer/`.
- `[#0015]` Telegram bot (`apps/bot-telegram/`) — auth + push channel per doc 13.
- `[#0016]` VStamp service — verifiable prediction receipts per doc 17.
- `[?]` GA4 + GTM container + Meta Pixel wiring (Tim provides IDs; we wire).
- `[?]` GoHighLevel (GHL) CRM sync — push signups + key events to GHL (Tim provides location ID + API key).
- `[?]` Aiva SMS + Aiva WhatsApp integration — share/receipt notifications via the Aiva SMS gateway (read `clawdia/skills/aiva-sms/SKILL.md`).
- `[?]` Reviewer agent dispatched on every open PR (`AGENT-PROMPTS.md` § 5) — held until first builder PR lands.

## P1 — Cloudflare / infra

- `[?]` Set up `tournamental.com` Cloudflare zone (Tim) → wire `dev.tournamental.com`, `preview.tournamental.com`, `api-dev.tournamental.com` tunnels.
- `[?]` Pick offsite-backup target (R2 vs S3 vs Tigris) and wire `VTORN_BACKUP_OFFSITE_DIR`.
- `[?]` Cron entries on this box for hourly/daily/weekly `db-backup.sh`.
- `[?]` Add a tunnel for `admin.tournamental.com` when admin agent is dispatched.

## P2 — gamification, sharing, virality (see `docs/24-gamification-and-virality.md`)

- `[?]` Badge system: definitions, award engine, display surfaces, share cards.
- `[?]` Streak system: weekly/season prediction streaks → bonus tokens.
- `[?]` Prediction IQ leaderboards (per doc 17).
- `[?]` Tournament Prophet bracket UI (post-MVP per REVIEW.md).
- `[?]` Auto-clip pipeline: per-goal short clips with caption + branding for socials.
- `[?]` Bot persona policies (lurker prompt / share prompt / super-engaged invite) per doc 23.

## P2 — open-source ergonomics

- `[?]` LICENSE-DOCS check in CI (CC-BY attribution test).
- `[?]` Reviewer agent (AGENT-PROMPTS § 5) automated — held until first builder PR lands.
- `[?]` Spec validator package — runtime JSON-schema validation against `@vtorn/spec`.
- `[?]` `prettier --check` and `black --check` in CI.
- `[?]` Bundle-size budget in CI (`apps/web` and `apps/admin`).
- `[?]` Lighthouse CI on `apps/web` demo route.

## P3 — later / maybe

- `[?]` ClickHouse warehouse + dbt models (when monthly events > 50M).
- `[?]` Native iOS / Android apps for contacts integration (per doc 20).
- `[?]` On-chain pools + TournamentalOracle audit (per doc 21).
- `[?]` Cayman + NZ legal incorporation work (per doc 19).
