# 2026-05-10 — odds-ingest initial build

**Agent**: odds-ingest
**Branch**: `feat/odds-ingest-service`
**Refs**: docs/29-polymarket-odds-integration.md, docs/30-gamification-and-affiliate-spine.md
**Status**: ready-for-review

## Plan

Build `apps/odds-ingest` end-to-end so the bracket page can show live W/D/L
chips for every group-stage match within 32 days of kickoff. Polymarket is
the primary source; The Odds API is the free-tier backup; a deterministic
mock derived from FIFA rankings is the safety net so every fixture always
has a number.

The HTTP surface is a small Fastify app on port `3340` (see "Open
questions" — the prompt asked for `3320` but that's already used by
`apps/marketing`). Storage is SQLite via `better-sqlite3` for
zero-infrastructure deploy; the schema deliberately mirrors the Postgres
schema in docs/29 so the future migration is mechanical.

## What landed

- `apps/odds-ingest/src/`:
  - `index.ts` — CLI entrypoint (boots store, seeds mock, starts HTTP, runs poll loops)
  - `config.ts` — env-driven config
  - `data.ts` — loader + alias index for `data/fifa-wc-2026/{teams,fixtures}.json`
  - `normalise.ts` — team-label → FIFA-code mapping, vig stripping, market classification
  - `poller.ts` — Polymarket Gamma loop (5 min) + The Odds API loop (60 min) + mock seeder
  - `clob-snapshot.ts` — Polymarket CLOB orderbook snapshot loop (30 s)
  - `api.ts` — Fastify routes
  - `sources/polymarket.ts` — Gamma + CLOB clients (read-only, no auth)
  - `sources/the-odds-api.ts` — The Odds API client (free-tier backup)
  - `sources/mock.ts` — deterministic FIFA-rank-based mock
  - `store/sqlite.ts` + `store/schema.sql` — SQLite-backed market + tick store
- `apps/odds-ingest/test/` — 30 vitest tests across normalise / polymarket / poller / api
- `apps/odds-ingest/README.md`, `.env.example`, `pm2-ecosystem.config.cjs`,
  `vitest.config.ts`, `tsconfig.json`, `.gitignore`
- Root `package.json`: `pnpm.onlyBuiltDependencies` allowlist for
  `better-sqlite3` so its install scripts run on `pnpm install`

## Open questions for Tim

1. **Port**: the brief said `3320`, but `apps/marketing` already binds 3320
   (see `apps/marketing/astro.config.mjs` and `docs/22`). I picked **3340**
   (the example port in `docs/22`). Happy to flip if you'd rather rebind
   marketing.
2. **The Odds API key**: register at https://the-odds-api.com/ for the
   free 500 req/month tier. Drop the key into `.env` as `THE_ODDS_API_KEY=...`
   and the secondary source flips on automatically. Without it, we fall
   back to Polymarket + mock.
3. **Polymarket tag slug**: `tag_slug=fifa-2026` is a guess until the
   Gamma API actually exposes 2026 markets. The client tries a list of
   plausible slugs (`fifa-world-cup`, `fifa-2026`, `world-cup-2026`) and
   then falls back to a generic active-markets query filtered by question
   text (`world cup` / `fifa`) so we shouldn't miss markets even if the
   tag slug name moves.
4. **Cloudflare ingress**: README documents the steps; I haven't actually
   added `vtorn-odds.aiva.nz` to the live tunnel because that touches
   shared infra. Recommend doing it in the merge step.

## Coverage check

At T-32-days the Polymarket per-match moneyline markets are sparse (only a
handful of high-profile group games published this far out). The mock
fallback handles every group fixture with `home_team_slot` and
`away_team_slot` resolvable in `teams.json`; knockout fixtures with
placeholder slots (e.g. "W49") gracefully degrade to a "no live odds yet"
nullable response.

## Next steps (out of scope this PR)

- WebSocket fanout to clients (`docs/29` Phase 5).
- Player-level top-scorer mapping (needs the players table).
- Postgres migration when the `apps/api` Postgres lands.
