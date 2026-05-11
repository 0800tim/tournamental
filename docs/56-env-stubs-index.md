# Pre-launch .env index — fill these before flipping public

Every service that reads from `process.env` (or `import.meta.env` for Astro)
now has a live, gitignored `.env` file with placeholders. Fill them in your
text editor in this order; restart the corresponding PM2 process after each.

> Quick generators
> - 32-hex secret: `openssl rand -hex 32`
> - 48-base64 secret: `openssl rand -base64 48`
> - VAPID keys (web push): `npx web-push generate-vapid-keys`

## Tier 1 — required for kickoff (2026-06-11)

| File | What's missing | Where the value comes from |
| --- | --- | --- |
| `.env` (top-level) | `POSTGRES_PASSWORD`, `REDIS_PASSWORD` are already real. **Add**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID_TOURNAMENTAL`, `CLOUDFLARE_TUNNEL_ID`, `GITHUB_TOKEN`, `NPM_TOKEN` | Cloudflare dashboard, GitHub PAT settings, npm classic automation token |
| `apps/web/.env.production` | All Supabase keys, `GHL_*`, `NEXT_PUBLIC_GTM_ID`, `TOURNAMENTAL_INTERNAL_SECRET` | Supabase project settings, GHL location settings, GA4/GTM, generate |
| `apps/game/.env.production` | Already has `GAME_ADMIN_TOKEN` filled | (no action) |
| `apps/auth-sms/.env` | `AUTH_OTP_SECRET`, `AUTH_JWT_SECRET`, `AUTH_ADMIN_TOKEN`, `AIVA_SMS_API_KEY`, `TELEGRAM_BOT_TOKEN` | Generate, Aiva admin, BotFather |
| `apps/identity/.env` | `IDENTITY_ADMIN_TOKEN`, `SUPABASE_JWT_SECRET` | Generate, Supabase API settings (must match apps/web + apps/game) |
| `apps/crm-bridge/.env` | `GHL_API_KEY`, `GHL_LOCATION_ID`, `CRM_ADMIN_TOKEN` | GHL location settings, generate |
| `apps/tournament-bot/.env` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | BotFather, generate |

## Tier 2 — required for full launch experience

| File | What's missing |
| --- | --- |
| `apps/admin/.env` | `ADMIN_EMAILS`, `ADMIN_JWT_SECRET`, `RESEND_API_KEY` (or Mailgun) |
| `apps/api/.env` | `ADMIN_JWT_SECRET` (must match `apps/admin`) |
| `apps/mcp/.env` | `TOURNAMENTAL_ADMIN_KEY` (must match game service admin token) |
| `apps/marketing/.env` | `PUBLIC_GTM_ID`, `NEXT_PUBLIC_GTM_ID` |
| `apps/dm-otp/.env` | Whatever channels you enable in `DM_OTP_ENABLED_CHANNELS` (Discord, email, Telegram defaults are enough for launch) |
| `apps/vstamp/.env` | `VSTAMP_ADMIN_TOKEN`, `VSTAMP_KEY_PASSPHRASE` |
| `apps/affiliate-router/.env` | `AFFILIATE_USER_HASH_SALT`, partner affiliate codes |
| `apps/odds-ingest/.env` | `THE_ODDS_API_KEY` (free tier optional) |
| `apps/push-notifications/.env` | VAPID keys, `PUSH_INTERNAL_SECRET` |
| `apps/stream-server/.env` | `STREAM_ADMIN_TOKEN` |
| `apps/clip-pipeline/.env` | `CLIP_STORAGE_URL` (R2/CDN base) |
| `apps/security-watchdog/.env` | At least one pager channel (Discord/Slack/Telegram/SMS) + `WATCHDOG_API_TOKEN` |
| `apps/news-aggregator/.env` | `NEWS_ADMIN_SECRET` |
| `apps/wc2026-data/.env` | `APIFOOTBALL_KEY` (free tier 100/day) |

## Tier 3 — nice to have, not blocking

| File | What's missing |
| --- | --- |
| `apps/drips-bridge/.env` | `DRIPS_PRIVATE_KEY`, `DRIPS_DRIP_LIST_ID` (Phase 2 — contributor revenue split) |
| `apps/social-publisher/.env` | TikTok / Instagram / YouTube / X / Threads keys (all stub-mode safe to launch without) |
| `apps/dm-poll-forwarder/.env` | Reddit / Mastodon / Signal credentials |
| `apps/pr-triage-bot/.env` | `GITHUB_REPOSITORY` already defaults to `0800tim/tournamental` |

## After filling each .env

```bash
# Reload the affected process
pm2 restart vtorn-<service>

# Or reload everything at once
pm2 restart all

# Spot-check the value got picked up (does NOT print the secret)
pm2 env <pm-id> | grep -i <var-name> | sed 's/=.*$/=<set>/'
```

## Where to find each file

```
/home/clawdbot/clawdia/projects/vtorn/.env                           # top-level
/home/clawdbot/clawdia/projects/vtorn/apps/admin/.env
/home/clawdbot/clawdia/projects/vtorn/apps/affiliate-router/.env
/home/clawdbot/clawdia/projects/vtorn/apps/api/.env
/home/clawdbot/clawdia/projects/vtorn/apps/auth-sms/.env
/home/clawdbot/clawdia/projects/vtorn/apps/clip-pipeline/.env
/home/clawdbot/clawdia/projects/vtorn/apps/crm-bridge/.env
/home/clawdbot/clawdia/projects/vtorn/apps/dm-otp/.env
/home/clawdbot/clawdia/projects/vtorn/apps/dm-poll-forwarder/.env
/home/clawdbot/clawdia/projects/vtorn/apps/drips-bridge/.env
/home/clawdbot/clawdia/projects/vtorn/apps/game/.env                 # alias for dev
/home/clawdbot/clawdia/projects/vtorn/apps/game/.env.production      # real prod
/home/clawdbot/clawdia/projects/vtorn/apps/identity/.env
/home/clawdbot/clawdia/projects/vtorn/apps/marketing/.env
/home/clawdbot/clawdia/projects/vtorn/apps/mcp/.env
/home/clawdbot/clawdia/projects/vtorn/apps/news-aggregator/.env
/home/clawdbot/clawdia/projects/vtorn/apps/odds-ingest/.env
/home/clawdbot/clawdia/projects/vtorn/apps/pr-triage-bot/.env
/home/clawdbot/clawdia/projects/vtorn/apps/push-notifications/.env
/home/clawdbot/clawdia/projects/vtorn/apps/security-watchdog/.env
/home/clawdbot/clawdia/projects/vtorn/apps/social-publisher/.env
/home/clawdbot/clawdia/projects/vtorn/apps/stream-server/.env
/home/clawdbot/clawdia/projects/vtorn/apps/tournament-bot/.env
/home/clawdbot/clawdia/projects/vtorn/apps/vstamp/.env
/home/clawdbot/clawdia/projects/vtorn/apps/wc2026-data/.env
/home/clawdbot/clawdia/projects/vtorn/apps/web/.env.production
```

All are gitignored. Treat them like passwords — never paste into Slack/Discord/screenshots.
