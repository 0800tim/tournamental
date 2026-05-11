# 26, Setup Checklist

> **Tim's printable to-do list for getting every external account ready
> for Tournamental's WC 2026 launch (kickoff 2026-06-11).**
>
> This doc is the **sequential** companion to
> [`docs/25-keys-and-secrets-required.md`](25-keys-and-secrets-required.md)
> (which lists the env-var names + values in deep detail). Open 25 only
> when you've just received a key and want to know exactly which `.env`
> line it goes on. Day-to-day, work the checkboxes below.
>
> All credentials get pasted into `.env` files **on the server only**,
> never committed to git. Where a checklist row says "→ paste in", that
> is shorthand for: SSH to the server, edit
> `apps/<service>/.env.production`, restart the PM2 process with
> `pm2 restart <process>`. The orchestrator's `infra/scripts/env-set.sh`
> wrapper does this idempotently.

---

## TL;DR, what's urgent this week

The bare minimum to get from "code works" to "people can actually use
the launched product" is **eight accounts**, in this order:

1. ☐ **Telegram bot** (BotFather), auth + push channel
2. ☐ **Aiva SMS verification**, confirm Tournamental can use the existing SIM gateway
3. ☐ **WhatsApp via Baileys**, re-pair the existing Baileys session under the Tournamental brand
4. ☐ **GoHighLevel**, location ID + API key (CRM + drip emails)
5. ☐ **GA4 + GTM**, analytics from day 1 or we can't measure launch
6. ☐ **Meta Pixel**, Facebook/Instagram ad attribution
7. ☐ **Polymarket affiliate** code, real-money market integration
8. ☐ **Cloudflare R2** bucket, offsite backup destination

Each of the eight is a 5–10 minute task on the provider's side. The
slowest is GHL because of their settings UI. Everything below is
"nice to have before launch" or "later".

---

## Phase 1, Brand handles & comms (do today)

### 1.0 Supabase Auth (new, replaces the legacy `apps/auth-sms` path)

- ☐ Provision a Supabase project per [`docs/52-supabase-setup.md`](52-supabase-setup.md) §1
- ☐ Run `supabase/migrations/0001_user_identity.sql` (dashboard or CLI)
- ☐ Paste the three project keys + JWT secret into `apps/web/.env.production`
- ☐ Generate and paste `SUPABASE_PHONE_HASH_SALT` (`openssl rand -hex 32`)
- ☐ Generate and paste `SUPABASE_SMS_HOOK_SECRET` (same; matches dashboard)
- ☐ Configure Email + Phone (custom hook) + Telegram domain per doc 52 §4
- ☐ Smoke test all three sign-in paths per doc 52 §6

### 1.1 Telegram bot

- ☐ Open <https://t.me/BotFather>
- ☐ Send `/newbot`
- ☐ Bot display name: **Tournamental Bot**
- ☐ Bot username: `@TournamentalBot` (or fallback `@TournamentalAppBot` if taken)
- ☐ Copy the token BotFather returns
- ☐ Configure the bot:
  - `/setdescription` → "Predict the FIFA WC 2026 bracket. Free to play. Save picks before kickoff."
  - `/setabouttext` → "Tournamental, predict the tournament that matters."
  - `/setuserpic` → upload the Tournamental T-mark from `apps/marketing/public/favicon.svg` (square 512×512 PNG)
  - `/setcommands` → paste the commands list from [`docs/13-telegram-bot-and-auth.md`](13-telegram-bot-and-auth.md) § Commands
- ☐ → Paste token into `apps/api/.env.production` as `TELEGRAM_BOT_TOKEN=...`
- ☐ Restart: `pm2 restart vtorn-api-prod`
- ☐ Verify: send `/start` to the bot; should receive the welcome message.

### 1.2 SMS gateway verification

- ☐ Stand up an SMS gateway (Aiva SMS by default, or any compatible gateway). See `packages/aiva-client/` for the request shape.
- ☐ Provision an API key and device.
- ☐ Test send: `curl -X POST "$AIVA_SMS_API_URL/api/v1/gateway/devices/$AIVA_SMS_DEVICE_ID/send-sms" -H "Authorization: Bearer $AIVA_SMS_API_KEY" -H 'Content-Type: application/json' -d '{"phoneNumber":"+64...","message":"Tournamental test"}'`
- ☐ Paste `AIVA_SMS_API_URL`, `AIVA_SMS_API_KEY`, `AIVA_SMS_DEVICE_ID` into `apps/auth-sms/.env.production`.

### 1.3 WhatsApp via Baileys (or via the gateway)

- ☐ Decide on the WhatsApp transport: `WHATSAPP_TRANSPORT=aiva` (default, uses the SMS gateway's WhatsApp session) or `WHATSAPP_TRANSPORT=baileys` (in-process).
- ☐ If using the gateway: paste `AIVA_WA_SESSION_ID` from the gateway.
- ☐ If using Baileys: pair a phone via QR (the auth-sms service exposes the pairing QR at `/v1/auth/whatsapp/pairing-qr`) and set `BAILEYS_AUTH_DIR`.
- ☐ Set the WhatsApp profile name → "Tournamental".
- ☐ Set the WhatsApp profile picture → same T-mark as Telegram.
- ☐ Smoke-test: `pnpm --filter @vtorn/auth-sms send-whatsapp --to=+64... --body="test"`.

### 1.4 Social handles (reserve them now, even if you won't post yet)

These don't require API access for launch, Tim just needs to **reserve the handles** so nobody else takes them once the brand is public.

- ☐ **X / Twitter**: reserve `@tournamental` (alt: `@tournamental_app`)
- ☐ **Instagram**: reserve `@tournamental` (alt: `@tournamental.app`)
- ☐ **TikTok**: reserve `@tournamental` (alt: `@tournamental.app`)
- ☐ **YouTube**: reserve channel handle `@tournamental`
- ☐ **Threads**: reserve `@tournamental` (mirrors Instagram)
- ☐ **Bluesky**: reserve `@tournamental.com` (uses domain verification, quick)
- ☐ **Mastodon**: skip for v1 unless we have a specific home server
- ☐ **LinkedIn**: create a Company Page (Tournamental Holdings), needed for partner outreach
- ☐ Once each handle is reserved, paste into `config/brand.json` so the marketing footer + share cards link to the right account

### 1.5 GitHub repo (✓ done)

- ☑ Repo renamed `vtorn` → `tournamental` (2026-05-11)
- ☑ Local remote updated
- ☑ Apache 2.0 + CC-BY for docs

---

## Phase 2, CRM & comms (do this week)

### 2.1 GoHighLevel (GHL), CRM

- ☐ Go to <https://gohighlevel.com> → log in to the agency account
- ☐ Create a new **sub-location**: "Tournamental"
- ☐ Settings → Business Profile → copy **Location ID**
- ☐ Settings → My Profile → Integrations → **Generate API Key** for this location
- ☐ → Paste both into `apps/api/.env.production`:
  ```
  GHL_LOCATION_ID=...
  GHL_API_KEY=...
  ```
- ☐ Set up these GHL custom fields on the contact object (one-time, in GHL UI):
  - `vtourn_user_id` (text, internal id, name kept for backwards-compat per the rebrand sweep)
  - `vtourn_last_event_id` (text, last event we forwarded)
  - `bracket_completion` (number 0–104)
  - `engagement_band` (text: cold / warm / hot)
- ☐ Create pipelines: "Bracket onboarding" / "WC 2026 engagement" / "Affiliate qualified"
- ☐ Restart: `pm2 restart vtorn-api-prod`

### 2.2 Google Analytics 4 + Google Tag Manager

- ☐ Go to <https://tagmanager.google.com> → create a **Web** container for `tournamental.com`
- ☐ Copy the container ID (`GTM-XXXXXXX`)
- ☐ Go to <https://analytics.google.com> → create a **GA4 property** for `tournamental.com`
- ☐ Copy the measurement ID (`G-XXXXXXXXXX`)
- ☐ Inside GTM, add a "Google Analytics: GA4 Configuration" tag using the measurement ID. Trigger: All Pages.
- ☐ → Paste into `apps/web/.env.production` and `apps/marketing/.env.production`:
  ```
  NEXT_PUBLIC_GTM_ID=GTM-XXXXXXX
  ```
- ☐ (Optional, for the admin dashboard's analytics page) In GCP, create a service account with **Viewer** on the GA4 property. Download the JSON key.
- ☐ → Paste into `apps/admin/.env.production`:
  ```
  GA4_PROPERTY_ID=000000000
  GA4_SA_JSON=/srv/secrets/ga4-sa.json
  ```
- ☐ Rebuild + restart marketing + web

### 2.3 Meta Pixel (Facebook + Instagram ad attribution)

- ☐ Go to <https://business.facebook.com> → Events Manager → Create Pixel
- ☐ Name the pixel "Tournamental" → copy the pixel ID
- ☐ → Paste into `apps/web/.env.production` and `apps/marketing/.env.production`:
  ```
  NEXT_PUBLIC_META_PIXEL_ID=000000000000000
  ```
- ☐ Configure the pixel inside GTM (one tag per page-view + key conversion events)
- ☐ Rebuild + restart

### 2.4 TikTok Pixel (later, only when running TT ads)

- ☐ TikTok Ads Manager → Tools → Events → New Pixel
- ☐ Name "Tournamental" → copy the pixel ID
- ☐ → Paste into the same two `.env` files:
  ```
  NEXT_PUBLIC_TIKTOK_PIXEL_ID=...
  ```

---

## Phase 3, External APIs (before launch, in any order)

### 3.1 Polymarket affiliate

- ☐ Apply at <https://polymarket.com/affiliates> with a brief pitch, "Tournamental is a free-to-play FIFA WC 2026 bracket app routing predictions to your markets"
- ☐ Wait 24–48 hours for approval
- ☐ → Paste the affiliate code into `apps/api/.env.production`:
  ```
  VTORN_POLYMARKET_AFF_CODE=...
  ```

### 3.2 ElevenLabs (AI commentary TTS), already wired

- ☐ If the existing Aiva ElevenLabs subscription covers Tournamental traffic: confirm with Tim. No new account needed.
- ☐ If not: <https://elevenlabs.io> → create new subscription → API key
- ☐ → `ELEVENLABS_API_KEY=...` in `apps/api/.env.production`

### 3.3 Anthropic API (for commentary script generation), already wired

- ☐ Same, confirm Tournamental can use the existing Anthropic key
- ☐ → `ANTHROPIC_API_KEY=...` in `apps/api/.env.production`

### 3.4 Cloudflare R2 (offsite backup)

- ☐ <https://dash.cloudflare.com> → R2 → Create bucket → name `tournamental-backups`
- ☐ Create API token scoped to that bucket only (Object Read + Object Write)
- ☐ → Paste into `apps/api/.env.production`:
  ```
  VTORN_R2_ACCESS_KEY=...
  VTORN_R2_SECRET_KEY=...
  VTORN_R2_BUCKET=tournamental-backups
  ```
- ☐ Run `infra/scripts/db-backup.sh --offsite=r2` to verify

### 3.5 Sentry (production error reporting)

- ☐ <https://sentry.io> → New Project → Next.js → name "Tournamental"
- ☐ Copy the DSN URL
- ☐ → Paste into `apps/web/.env.production`, `apps/api/.env.production`, `apps/marketing/.env.production`:
  ```
  SENTRY_DSN=https://...@sentry.io/...
  ```

---

## Phase 4, Cloudflare ops (mostly done)

- ☑ `tournamental.com` zone added (2026-05-11)
- ☑ Tunnel ingress configured for `2026wc`, `app`, `play`, `www`, `api`, `stream` (latest: `play.tournamental.com` 2026-05-11)
- ☑ CNAME records created for the above
- ☐ Add `admin.tournamental.com` ingress when the admin dashboard goes live (script ready at `infra/scripts/cf-add-tournamental-hosts-admin.sh`)
- ☐ Cloudflare Pages project for the marketing site (optional, currently served via PM2 + tunnel; Pages is a future migration if we want zero-touch deploys)

---

## Phase 5, Native app stores (when ready)

The Capacitor wrapper is ready in `apps/native/`. Pushing to the stores requires:

### 5.1 Apple App Store

- ☐ Apple Developer Program membership ($99/yr) for the **Tournamental Holdings** legal entity
- ☐ App Store Connect → New App → Bundle ID `com.tournamental.app`
- ☐ Generate App-Specific Password for CI uploads
- ☐ → `APPLE_TEAM_ID=...`, `APPLE_APP_STORE_API_KEY_ID=...`, key p8 file path in `apps/native/.env`

### 5.2 Google Play Store

- ☐ Google Play Console developer account ($25 one-off)
- ☐ Create app → package name `com.tournamental.app`
- ☐ Service account for CI uploads → JSON key
- ☐ → `GOOGLE_PLAY_SA_JSON=/srv/secrets/play-sa.json` in `apps/native/.env`

### 5.3 Push notifications (after the apps ship)

- ☐ iOS APNS p8 key from Apple Developer
- ☐ Android FCM server key from Firebase Console
- ☐ Web Push VAPID keypair generated via `web-push generate-vapid-keys`
- ☐ All three go into `apps/push-notifications/.env.production`

---

## Phase 6, Legal / payment / on-chain (later, post-launch)

These are NOT blockers for the 2026-06-11 launch. Defer until needed.

- ☐ **Tournamental Holdings** legal incorporation (NZ or other jurisdiction Tim picks)
- ☐ **Stripe** account for the entity (optional revenue routing)
- ☐ **Drips Network** drip list creation once Foundation is incorporated → `VTORN_DRIPS_LIST_ID`
- ☐ **EVM RPC** (Base mainnet or chosen L2), Alchemy / Infura / QuickNode → `VTORN_EVM_RPC_URL`
- ☐ **Oracle signer keypair** in AWS KMS → `VTORN_ORACLE_SIGNER_PRIVKEY` (HSM-only, never in `.env`)
- ☐ **Sportsbook partnerships** (Bet365 / Pinnacle / etc.), 1–3 month lead time per REVIEW.md

---

## How to paste a credential (the universal recipe)

For every "→ paste into `apps/<service>/.env.production`" row above:

```bash
# 1. SSH to the server (or open the tmux session if you're already there).
# 2. Edit the file:
$EDITOR /path/to/vtorn/apps/<service>/.env.production
# 3. Add or update the env var on its own line, KEY=VALUE, no quotes around the value.
# 4. Save + close.
# 5. Restart the PM2 process for that service:
pm2 restart vtorn-<service>-prod
# 6. Verify the process logs show no missing-credential errors:
pm2 logs vtorn-<service>-prod --lines 30
```

**Never** commit `.env.production` to git. The repo has `.env.example`
files only, those document the variable names without the secrets.
`.gitignore` already covers `.env`, `.env.local`, `.env.production`.

---

## What unlocks what (the dependency chain)

If you only have 2 hours, do these four and the platform is "minimally
launchable", payments + on-chain can wait:

1. Telegram bot token → unlocks the bot identity layer (auth + push)
2. Aiva SMS confirmation → unlocks transactional SMS (auth codes, kickoff nudges)
3. GHL location + API key → unlocks the contact funnel + drip emails
4. GA4 + GTM → unlocks every analytics view in the admin dashboard

Without any of these the app still runs (the bracket builder + 3D
match renderer don't need external accounts), but the launch
funnel can't move users through the engagement loop without them.

---

## When you finish a step

- ☑ Tick the checkbox in this doc and commit it.
- ☐ The orchestrator records a one-line outcome in `tasks/done/`
  (e.g. "GHL location ID received 2026-05-12, wired into apps/api,
  smoke test 200").
- ☐ Notify any builder agent that the integration is now unblocked.

If a credential is **exposed** (committed to git, leaked in a
screenshot, sent over a non-E2E channel): rotate it at the provider
**immediately**. History rewrite is not a fix, assume the secret is
burned. Then file `sessions/<date>_security-incident_<slug>.md` with
the timeline.
