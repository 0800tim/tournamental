# Tournamental Go-Live Checklist

**Target**: public launch with auth + bracket play working end-to-end so we can attract OSS contributors while we polish in parallel.

This doc is the single source of truth for **what env vars go where** and **how to confirm each subsystem is live**. Anything not in this file isn't blocking the public launch.

The four services that need env vars on this box:

| Service | Process | Env file (gitignored) | Public host |
| --- | --- | --- | --- |
| `apps/auth-sms` | `vtorn-auth-sms` (PM2) | `apps/auth-sms/.env` | `auth.tournamental.com` |
| `apps/web` (play app) | `vtorn-web` (PM2) | `apps/web/.env.production` | `play.tournamental.com` |
| `apps/marketing` | `vtorn-marketing-prod` (PM2) | `apps/marketing/.env` | `tournamental.com` |
| `apps/game` | `vtorn-game-prod` (PM2) | `apps/game/.env` | `game.tournamental.com` |

Restart pattern after editing any `.env`:

```bash
pm2 restart vtorn-auth-sms     # auth-sms reads .env on boot
pm2 restart vtorn-web          # NEXT_PUBLIC_* requires rebuild first:
                               #   cd apps/web && pnpm build && pm2 restart vtorn-web
pm2 restart vtorn-marketing-prod
pm2 restart vtorn-game-prod
```

---

## 1. Authentication (MUST for launch)

Three sign-in channels, all independent. Any one of them is enough to launch. Ideally all three.

### 1a. Telegram Login Widget  ✅ free, worldwide, instant

This is the cheapest, fastest, most international path. Zero per-use cost. Already wired end-to-end.

**`apps/auth-sms/.env`:**

```env
TELEGRAM_BOT_TOKEN=<REDACTED-rotate-via-BotFather-before-public-launch>
TELEGRAM_BOT_USERNAME=TournamentalGamesBot
```

**`apps/web/.env.production`:**

```env
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=TournamentalGamesBot
```

**One-off BotFather step** (open Telegram → @BotFather):

```
/setdomain                     ← select TournamentalGamesBot
tournamental.com               ← reply with apex domain only
```

Without `/setdomain`, the Login Widget refuses to render on any page.

**Verify**:

```bash
# Endpoint reachable + bot token loaded:
curl -sS https://auth.tournamental.com/v1/auth/telegram/callback \
  -H "content-type: application/json" \
  -d '{"id":1,"first_name":"x","auth_date":1,"hash":"0000000000000000000000000000000000000000000000000000000000000000"}'
# Expect:  {"error":"bad-hash"}   ← means token is loaded, HMAC verifier ran
# Bad:     {"error":"not-configured"}  ← token missing
```

Then on `play.tournamental.com`, open the sign-in modal → Telegram tab → tap the blue "Log in with Telegram" button → approve in Telegram → you land back signed in.

### 1b. WhatsApp inbound-login  ✅ free, worldwide, requires Aiva SMS gateway

Already working. User messages `login` to `+64 20 4259096` on WhatsApp, gets back a 6-digit code + magic link. The Aiva gateway forwards the inbound to auth-sms.

**`apps/auth-sms/.env`** (already set):

```env
INBOUND_LOGIN_SECRET=<openssl rand -hex 32>          # shared with Aiva gateway
INBOUND_MAGIC_MAX_ATTEMPTS=5
INBOUND_CODE_IP_FAILURE_MAX=60
INBOUND_COOKIE_DOMAIN=.tournamental.com
WHATSAPP_TRANSPORT=aiva
AIVA_SMS_URL=https://aiva.nz/...
AIVA_SMS_API_KEY=<aiva-issued>
```

The Aiva gateway side already routes Tournamental inbound to `https://auth.tournamental.com/v1/auth/inbound-login` (PR landed yesterday). If WhatsApp stops responding, check `pm2 logs vtorn-auth-sms` for `inbound.login.*` audit lines.

### 1c. SMS inbound-login (NZ + AU only)

Same flow as WhatsApp, gated by country. The UI only shows the SMS button when `detectSmsCountry()` returns `"NZ"` or `"AU"`; everyone else is steered to WhatsApp. No additional env vars beyond the Aiva ones above.

### 1d. Email magic-link via SendGrid  ⏳ planned

**Not yet implemented.** Needs:

- SendGrid account + verified sender domain (DKIM/SPF)
- `apps/auth-sms/.env`:
  ```env
  SENDGRID_API_KEY=
  SENDGRID_FROM=login@tournamental.com
  SENDGRID_FROM_NAME=Tournamental
  ```
- New `apps/auth-sms/src/sendgrid.ts` + `apps/auth-sms/src/routes/email-otp.ts`
- Storage extension: `phone_otp.email` column (nullable, alongside phone)

Plan-of-record: ship after Telegram + WhatsApp prove out the molecule.

---

## 2. CRM (HighLevel)  ⏳ planned, not blocking

We push every new user (Telegram, WhatsApp, SMS, email) into GoHighLevel for drip emails + retargeting. **API-driven** (not webhooks) so it costs no LLM tokens.

**`apps/auth-sms/.env`** (when ready):

```env
HIGHLEVEL_API_KEY=
HIGHLEVEL_LOCATION_ID=
HIGHLEVEL_PIPELINE_ID=                    # optional, only if we want auto-pipeline placement
```

**Already in `apps/web/.env.production`** for syndicate signup (separate path):

```env
GHL_API_KEY=
GHL_LOCATION_ID=
```

Fire-and-forget call on every `findOrCreateUser`. Profile patches (name, email, country, fav team) trigger a contact.update.

Not launch-blocking — without it, users still sign in fine; we just miss the marketing list growth from day 1. **Add as soon as the HighLevel account is set up.**

---

## 3. Play app + Bracket game (MUST for launch)

The play app talks to `apps/game` (FastAPI-style SQLite-backed bracket service) over HTTP.

**`apps/web/.env.production`** core values (all already set on this box):

```env
# Public origin
NEXT_PUBLIC_PLAY_HOST=https://play.tournamental.com
NEXT_PUBLIC_INVITE_BASE_URL=https://play.tournamental.com

# Game service
NEXT_PUBLIC_GAME_API_BASE=https://game.tournamental.com
NEXT_PUBLIC_GAME_API_URL=https://game.tournamental.com
NEXT_PUBLIC_VTORN_GAME_URL=https://game.tournamental.com
GAME_API_BASE=http://localhost:3360       # server-side SSR
VTORN_GAME_URL=http://localhost:3360
GAME_DB_PATH=/home/clawdbot/clawdia/projects/vtorn/apps/game/data/game.db

# Auth-sms (both names accepted by different modules)
NEXT_PUBLIC_AUTH_API_URL=https://auth.tournamental.com
NEXT_PUBLIC_AUTH_BASE_URL=https://auth.tournamental.com

# Telegram Login Widget bot username
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=TournamentalGamesBot

# Service-to-service shared secret (game → web webhook)
TOURNAMENTAL_INTERNAL_SECRET=<openssl rand -hex 32>
```

**Verify**:

```bash
curl -sS https://play.tournamental.com/api/health    # → {"ok":true}
curl -sS https://game.tournamental.com/healthz      # → ok
```

Then open `https://play.tournamental.com/world-cup-2026`, sign in with Telegram, save a bracket, log out, log back in via WhatsApp → bracket survives the channel switch (same user record).

---

## 4. Marketing site (MUST for launch)

Astro. Mostly static, plus a `/media`, `/press`, blog posts.

**`apps/marketing/.env`** (minimal):

```env
PUBLIC_PLAY_URL=https://play.tournamental.com
PUBLIC_AUTH_BASE=https://auth.tournamental.com
PUBLIC_TELEGRAM_BOT_USERNAME=TournamentalGamesBot
```

**Verify**: `curl -I https://tournamental.com` → 200, `/media`, `/press` reachable.

---

## 5. Analytics (MUST for launch — we can't measure if we skip these)

**`apps/web/.env.production`** and **`apps/marketing/.env`**:

```env
NEXT_PUBLIC_GTM_ID=GTM-XXXXXXX            # Google Tag Manager container
```

(The Meta Pixel + GA4 sit inside GTM, so one container ID covers both.)

Set up:
1. Create a GTM container at https://tagmanager.google.com.
2. Add a GA4 Configuration tag in GTM → "All Pages" trigger.
3. Add a Meta Pixel base-code tag → "All Pages" trigger.
4. Publish.

**Verify**: open the site in incognito, run `dataLayer` in DevTools console — should see page-view events.

---

## 6. Optional / later (not launch-blocking)

| Subsystem | Env var(s) | When |
| --- | --- | --- |
| ElevenLabs commentary | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN` in `apps/web/.env.production` | when audio mix is enabled |
| Live odds + news | `ODDS_API_URL`, `NEWS_AGG_URL` (both already point at internal services) | working |
| WC 2026 livestream | `NEXT_PUBLIC_VTORN_WS_URL=wss://stream.tournamental.com` | watch-along phase |
| On-chain pool + VStamp | `VSTAMP_*`, `ANCHOR_PRIVATE_KEY`, `POOL_CONTRACT_ADDRESS` | post-audit phase |
| Polymarket affiliate | `POLYMARKET_AFFILIATE_CODE` (whichever module needs it) | when real-money molecule ships |

---

## 7. Subdomains / CNAMEs (already wired, here for reference)

All point at the same Cloudflare tunnel (`68c2f5b4-8713-441b-9de5-1933557a443b.cfargotunnel.com`). Ingress rules in the tunnel config map host → localhost port:

| Subdomain | Local port | Service |
| --- | --- | --- |
| `tournamental.com` | 3320 | marketing |
| `www.tournamental.com` | 3320 | marketing |
| `play.tournamental.com` | 3300 | web (play) |
| `auth.tournamental.com` | 3330 | auth-sms |
| `game.tournamental.com` | 3360 | game |
| `odds.tournamental.com` | 3341 | odds-api |
| `news.tournamental.com` | 3344 | news-agg |
| `stream.tournamental.com` | 4001 | producer (when active) |

To add a new subdomain: Cloudflare API → CNAME → tunnel hostname, plus tunnel ingress rule. See `docs/22-deployment-and-tunnels.md`.

---

## 8. Pre-launch smoke test

Run this five-minute checklist immediately before announcing publicly:

```bash
# 1. All four PM2 services online
pm2 status | grep -E "vtorn-(auth-sms|web|marketing-prod|game-prod)"
# Expect: all four "online", no recent crashes

# 2. Each public host responds 200
for host in tournamental.com play.tournamental.com auth.tournamental.com game.tournamental.com; do
  printf "%-40s %s\n" "$host" "$(curl -sS -o /dev/null -w '%{http_code}' https://$host/)"
done

# 3. Auth endpoints
curl -sS https://auth.tournamental.com/health                          # → {"ok":true}
curl -sS https://auth.tournamental.com/v1/auth/telegram/callback \
  -X POST -H "content-type: application/json" \
  -d '{"id":1,"first_name":"x","auth_date":1,"hash":"'$(printf '0%.0s' {1..64})'"}'
# Expect: {"error":"bad-hash"}    (NOT "not-configured")

# 4. Game service round-trip
curl -sS https://game.tournamental.com/v1/tournaments | jq '.tournaments | length'
# Expect: >= 1   (WC 2026 baseline present)
```

Then manually:

1. Open `https://tournamental.com` in incognito → click "Play" → land on `play.tournamental.com/world-cup-2026`.
2. Click "Sign in" → modal opens → tap "Telegram" tab → approve → return signed in.
3. Save a 4-team bracket. Refresh. Bracket persists.
4. Click "Sign out" → sign back in via WhatsApp (text `login` to `+64 20 4259096`, paste the 6-digit reply). Bracket still there.
5. Open `/profile` → country auto-detected from phone? Favourite-team flag grid loads? Save a change → 200, persists across reload.

If all five pass, we're cleared to announce.

---

## 9. What's not in this checklist (and why)

- **Supabase**: legacy auth path. The current architecture uses `apps/auth-sms` directly. Supabase env vars in `.env.production` are placeholders — leaving them empty is correct.
- **Drips Network / contributor revenue**: post-launch ops, not user-facing.
- **VStamp + on-chain pool**: gated on smart-contract audit, separate phase.
- **3D renderer / watch-along**: feature for WC 2026 matches, not blocking the bracket game.

These all matter, but they don't gate the public launch.
