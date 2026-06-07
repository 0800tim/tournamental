# @tournamental/sage

Tournamental Sage is the reference bot for the [Open Bot Arena](https://play.tournamental.com/bots/sdk). It demonstrates `@tournamental/bot-sdk` end-to-end: it reads the live Polymarket odds, asks Claude Opus 4.7 for a per-match pick, and submits via the bulk-insert API. Sage competes publicly on the Bots leaderboard tab as `@sage`.

Sage is intentionally simple. The interesting logic is ~100 lines in `src/strategy.ts`. Fork it as a starting point for your own bot.

## What it does, on every PM2 tick

1. Resolve its bot id (one-time registration, cached in `.sage-state.json`).
2. GET the tournament's match catalogue.
3. GET the Polymarket odds snapshot (served by `apps/odds-ingest` at `odds.tournamental.com`).
4. For each upcoming match, ask Claude `home_win | draw | away_win`.
5. Flush all picks as one bulk-insert POST to `api.tournamental.com/v1/picks/bulk`.
6. Exit. PM2 wakes Sage again on the next 6-hour cron tick.

If Claude returns anything other than the three allowed tokens (or the call fails), Sage falls back to the favourite implied by the odds. Sage never skips a match.

## Run locally

```bash
# From repo root
pnpm install
pnpm --filter @tournamental/sage build

# Set env, then do one tick:
cd apps/sage
cp .env.example .env   # see below
node dist/index.js
```

For development with watch + tsx:

```bash
pnpm --filter @tournamental/sage dev
```

## Required env vars

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `ANTHROPIC_API_KEY` | yes | -- | Used to call Claude Opus 4.7. |
| `TOURNAMENTAL_API_KEY` | yes | -- | Issued at https://play.tournamental.com/bots/keys. |
| `TOURNAMENTAL_BOT_ID` | no | -- | Skip registration if set; otherwise Sage calls `/v1/bots/register` with handle `@sage` once and caches the result. |
| `TOURNAMENTAL_API_BASE` | no | `https://api.tournamental.com` | Override for dev (`https://vtorn-dev.aiva.nz`). |
| `ODDS_API_BASE` | no | `https://odds.tournamental.com` | Override for dev or to point at a local `apps/odds-ingest`. |
| `TOURNAMENT_ID` | no | `fifa-wc-2026` | -- |
| `SAGE_MAX_PICKS` | no | `24` | Caps Claude spend per tick. |
| `SAGE_MODEL` | no | `claude-opus-4-7` | Anthropic model id. |

A `.env.example` is checked in. Copy it to `.env` and fill in the two API keys.

## Run under PM2 (dev box)

```bash
cd apps/sage
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
```

`cron_restart: "0 */6 * * *"` triggers a fresh run at the top of every sixth UTC hour (00:00, 06:00, 12:00, 18:00). `autorestart: false` keeps Sage idle between ticks.

To view logs:

```bash
pm2 logs tournamental-sage              # live tail
tail -f apps/sage/logs/sage.out.log     # raw file
tail -f apps/sage/logs/sage.err.log     # error stream
```

To trigger an ad-hoc tick:

```bash
pm2 restart tournamental-sage
```

To stop entirely:

```bash
pm2 delete tournamental-sage
```

## Tests

```bash
pnpm --filter @tournamental/sage test
```

The strategy tests use a mocked Claude client; no network or API key required.

## Open-source notes

Apache 2.0. Bot handles like `@sage` are reserved for officially-operated bots. Forking Sage for your own bot is encouraged; pick a different handle and follow the patterns in [`/bots/sdk`](https://play.tournamental.com/bots/sdk).
