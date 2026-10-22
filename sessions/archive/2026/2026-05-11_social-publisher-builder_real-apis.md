# Session: real Discord, Telegram, Reddit adapters for social-publisher

- Date: 2026-05-11
- Agent: social-publisher-builder
- Branch: feat/social-publisher-real-apis
- Refs: docs/27-social-distribution-strategy.md, apps/social-publisher/

## Plan

1. Replace stubs in Discord, Telegram, Reddit with real API calls. The other
   five (TikTok, IG Reels, YT Shorts, X, Threads) need App Review or paid
   tiers — leave as stubs but tighten the TODO comments.
2. Mirror the WhatsApp adapter pattern: factory with injected deps + an
   env-backed default. Stub fallback when env is missing so existing generic
   tests still pass.
3. Per-tournament configs:
   - `config/discord-webhooks.json` — tournamentId -> [webhook URL...]
   - `config/telegram-targets.json` — tournamentId -> [chat id...]
   - `config/reddit-targets.json` — tournamentId -> [subreddit...]
   Each has an `enabled` toggle so an operator can pause without code.
4. `/healthz` reports per-adapter mode (real vs stub) at boot.
5. Tests mock `fetch`, never post. Failure modes get persisted to
   `data/posts.jsonl` via the existing publish orchestrator.

## Decisions

- **Telegram transport**: tournament-bot has no exported HTTP push endpoint
  yet; the push helpers require a `Bot` + `Storage` instance and aren't a
  workspace package. Pragmatic path: post directly to the Telegram Bot API
  (`/bot{token}/sendVideo` or `sendDocument` for >50MB) using
  `TELEGRAM_BOT_TOKEN`. If `TOURNAMENT_BOT_PUSH_URL` is set, the adapter
  POSTs to `${url}/v1/push` instead — leaves room for the bot to expose one
  later without re-tooling this app.
- **Discord rate-limit**: respect `X-RateLimit-Remaining` / `X-RateLimit-Reset-After`
  headers; sleep when remaining hits 0; back off on 429.
- **Reddit OAuth**: script-app password grant; cache the access token until
  a minute before expiry. Per-subreddit cooldown of 10 min and 24h crosspost
  detection live in module state — fine for v0.1 (single instance).

## Outcome

See PR for diff. Key files:
- src/lib/adapters/discord.ts — real, factory + env default
- src/lib/adapters/telegram.ts — real, factory + env default
- src/lib/adapters/reddit.ts — real, factory + env default
- src/lib/adapter-mode.ts — boot-time mode reporter for /healthz
- config/{discord-webhooks,telegram-targets,reddit-targets}.json — Tim populates
- tests/{discord,telegram,reddit}-adapter.test.ts — fetch-mocked
