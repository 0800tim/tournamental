# @vtorn/identity

Multi-provider OAuth link adapters + Humanness Score.
Fastify HTTP server on **:3392**.

See [docs/20-identity-humanness-bots.md](../../docs/20-identity-humanness-bots.md)
for the full design.

## Endpoints

| Method | Path                                  | Notes |
|--------|---------------------------------------|-------|
| POST   | `/v1/links/start`                     | `{userId, provider}` -> mock OAuth URL |
| POST   | `/v1/links/callback`                  | `{userId, provider, externalId, profile?}` -> persisted link |
| GET    | `/v1/users/:userId/links`             | List linked providers |
| GET    | `/v1/users/:userId/humanness`         | Score 0-100 + factor breakdown |
| POST   | `/v1/users/:userId/recompute`         | Admin: `Authorization: Bearer $IDENTITY_ADMIN_TOKEN` |
| GET    | `/healthz`                            | Liveness |
| GET    | `/v1/version`                         | Service + version |

## Providers (MVP — mock URLs)

Real OAuth wiring lives behind `lib/providers/<id>.ts`. Each adapter file
documents the production URL pattern and the env vars Tim must provision:

- **Google**: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
- **Apple**: `APPLE_TEAM_ID`, `APPLE_SERVICES_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_REDIRECT_URI`
- **Telegram**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_ID`, `TELEGRAM_BOT_NAME`
- **X**: `TWITTER_OAUTH_CLIENT_ID`, `TWITTER_OAUTH_CLIENT_SECRET`, `TWITTER_OAUTH_KEY`, `TWITTER_BEARER_TOKEN`
- **Discord**: `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`
- **Phone**: `AUTH_SMS_BASE_URL`, `AUTH_SMS_SERVICE_TOKEN`

Service-level env:

- `IDENTITY_PORT` (default `3392`)
- `IDENTITY_PUBLIC_BASE_URL` (callbacks expect to land here)
- `IDENTITY_ADMIN_TOKEN` (gates `/recompute`)
- `IDENTITY_LINKS_PATH`, `IDENTITY_SCORES_PATH` (JSONL data files)

## Humanness Score

Factor weights (full table + rationale in `src/lib/humanness.ts`):

| factor                 | weight |
|------------------------|--------|
| base                   |   +5   |
| provider_stack (cap)   |  +50   |
| provider_diversity     |  +10   |
| link_freshness         |   +5   |
| telegram_premium       |   +3   |
| x_verified             |   +2   |
| behaviour_consistency  |  +10   |
| device_fingerprint     |   +5   |
| captcha_pass_rate      |   +5   |
| friend_reciprocity     |   +0   | (v0.3, placeholder)
| bot_signals            |  -25   |

## Run

```bash
pnpm -C apps/identity install
pnpm -C apps/identity dev      # tsx watch
pnpm -C apps/identity test     # vitest run
pnpm -C apps/identity typecheck
```
