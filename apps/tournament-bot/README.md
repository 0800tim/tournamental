# `@vtourn/tournament-bot`

> Telegram + WhatsApp bot for VTourn — main `@VTournBot` plus a WhatsApp
> surface via the Aiva gateway. Same command dispatcher serves both. Webhook-mode HTTP service on port `3350`. Reads
> `TELEGRAM_BOT_TOKEN` (required) and the `AIVA_*` vars (optional, enables
> WhatsApp) from `.env`. SQLite storage at `tg.db` (gitignored).

This is the v0 implementation of the bot described in
[docs/13-telegram-bot-and-auth.md](../../docs/13-telegram-bot-and-auth.md)
and the push policy in
[docs/30-gamification-and-affiliate-spine.md](../../docs/30-gamification-and-affiliate-spine.md).

It ships:

- `/start`, `/picks`, `/odds`, `/leaderboard`, `/syndicate`, `/help` commands
- a single Fastify webhook (`POST /v1/telegram/webhook`) that grammY consumes
- five push helpers (market-move, lock-mult expiry, kickoff, goal, affiliate CTA)
- per-user notification policy: 3/day cap, quiet hours, geo-gating for
  Polymarket affiliate CTAs (NZ + AU blocked by default)
- syndicate metadata + member roles in SQLite

It deliberately does **not** ship per-syndicate fresh bots via BotFather's
HTTP-bot-management API — that's option B in the task spec, parked in
[`IDEAS.md`](../../IDEAS.md). For v0 we use **deep-link payloads on the
single main bot** to scope conversations to a syndicate.

---

## Runbook — getting the bot live

This is the runbook a human (Tim) follows once. After it's done, the bot
runs as a long-lived service behind the existing Cloudflare tunnel.

### 1. Register a bot with BotFather

1. Open Telegram, search **`@BotFather`**, tap *Start*.
2. Send `/newbot`.
3. Name: `VTourn` (or `VTourn Bot`). Username: `VTournBot` (or another
   available `@...Bot` handle — see *Open questions* in the session note).
4. BotFather replies with an HTTP API token of the form
   `123456789:AAFr...`. Save it; you'll only see it once.
5. Set the user-facing description and command list:
   ```
   /setdescription
   The never-finished bracket. Lock picks, watch the market move, win.

   /setabouttext
   VTourn — the never-finished tournament prediction game.

   /setcommands
   start - Connect your bracket
   picks - View your bracket
   odds - Live market probability for a team
   leaderboard - Your rank
   syndicate - Manage syndicate
   help - Help
   ```
6. (Optional but recommended) `/setjoingroups` → *Disable* until the
   group-leaderboard feature ships (doc 13 § Channels and groups).

### 2. Configure the local environment

```bash
cd apps/tournament-bot
cp .env.example .env
# Open .env and paste:
#   TELEGRAM_BOT_TOKEN=<token from BotFather>
#   TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
```

Generate a webhook secret if you don't have one:

```bash
openssl rand -hex 32
```

### 3. Add a Cloudflare tunnel hostname

Per [docs/22-deployment-and-tunnels.md](../../docs/22-deployment-and-tunnels.md)
— the Aiva tunnel ingress is **remotely managed**, not via the local
`config.yml`. Use the API procedure documented there to add:

```
bot.vtourn.com → http://localhost:3350
```

Quick form (read the doc-22 procedure for the full version):

```bash
source /home/clawdbot/.cloudflared/cf-api-token
ACCOUNT_ID=f08ad6bd468886c7d991a817b3bbbeba
TUNNEL_ID=68c2f5b4-8713-441b-9de5-1933557a443b
HOST=bot.vtourn.com
PORT=3350

cloudflared tunnel route dns "$TUNNEL_ID" "$HOST"

# (Then PUT the merged ingress as in doc 22.)
```

Smoke-test the tunnel before pointing Telegram at it:

```bash
curl -sI https://bot.vtourn.com/ | head -3
# HTTP/2 502 (or whatever the local service returns) is healthy — Cloudflare
# reached us. HTTP/2 530 means the DNS / ingress half is missing.
```

### 4. Boot the bot

```bash
cd apps/tournament-bot
pnpm install
pnpm build
node dist/index.js
# tournament-bot listening on :3350, bot=@VTournBot
```

For dev with auto-restart:

```bash
pnpm dev
```

### 5. Register the webhook with Telegram

```bash
TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2-)"
SECRET="$(grep '^TELEGRAM_WEBHOOK_SECRET=' .env | cut -d= -f2-)"

curl -sS -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d @- <<JSON
{
  "url": "https://bot.vtourn.com/v1/telegram/webhook",
  "secret_token": "${SECRET}",
  "drop_pending_updates": true,
  "allowed_updates": ["message", "callback_query"]
}
JSON
```

Verify:

```bash
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq .
# .result.url should match what you set
# .result.pending_update_count should be 0 within a few seconds
```

### 6. Smoke-test from a real Telegram client

1. In Telegram, open `https://t.me/VTournBot` (replace with the actual
   username you registered).
2. Tap *Start*. The bot should reply with the `/start` welcome message.
3. Send `/help` — see the command list.
4. Send `/syndicate create demo Demo Syndicate` (it'll prompt to pair an
   account; for now confirm the validation message renders).

### 7. Inbound from web (deep-link login)

Web flow: when the user taps "Sign in with Telegram", the web app
generates an OTC and shows the user `https://t.me/VTournBot?start=login_<code>`.
The bot's `/start` handler parses `login_*` payloads and acknowledges; the
production wiring (see `docs/13` § Path A) consumes the OTC against Redis.

### 8. Inbound from web (syndicate invite)

When a syndicate is created in the dashboard, the share link is
`https://t.me/VTournBot?start=syn_<slug>`. The bot routes that into a
syndicate-flavoured welcome and prompts for `/picks` etc.

### 9. Optional — WhatsApp parity via the Aiva gateway

WhatsApp uses the same dispatcher (`src/lib/dispatch.ts`) as Telegram, so
every command (`/start`, `/picks`, `/odds`, `/leaderboard`, `/syndicate`,
`/help`) works on either surface. Outbound goes through Aiva's HTTP send;
inbound is a signed webhook the gateway POSTs to us.

1. **Pair the WhatsApp number once.** Open the Aiva admin dashboard, create
   (or pick) a WhatsApp session, and pair it with the bot's WhatsApp
   account by scanning the QR. Note the session ID and the API key.
2. **Generate a webhook shared secret:**

   ```bash
   openssl rand -hex 32
   ```

3. **Configure `.env`:**

   ```bash
   AIVA_SMS_API_URL=http://localhost:9252      # or your gateway URL
   AIVA_SMS_API_KEY=<aiva bearer token>
   AIVA_WA_SESSION_ID=<session id from step 1>
   AIVA_WEBHOOK_SECRET=<the secret from step 2>
   ```

   Restart the bot. You'll see `aiva-wa webhook registered` in the logs.

4. **Point the Aiva gateway at us.** In the Aiva admin UI, set the inbound
   webhook for this session to `https://bot.vtourn.com/v1/webhooks/aiva-wa`
   and paste the shared secret. The gateway HMAC-signs each inbound body
   as `X-Signature: sha256=<hex>`; we reject anything else.

5. **Smoke-test from a real WhatsApp client.** Send `/help` to the paired
   WhatsApp number — you should get the command list back.

   Or test the webhook locally:

   ```bash
   BODY='{"from":"64211234567@s.whatsapp.net","text":"/help"}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$AIVA_WEBHOOK_SECRET" -hex | awk '{print "sha256="$2}')
   curl -X POST http://localhost:3350/v1/webhooks/aiva-wa \
     -H "content-type: application/json" \
     -H "x-signature: $SIG" \
     -d "$BODY"
   # → 204 No Content; the gateway's send API gets a /help reply.
   ```

What's the same vs different between TG and WA:

- **Same**: every command, every reply text, every storage interaction. The dispatcher (`src/lib/dispatch.ts`) is the single source of truth.
- **Different on WA**: deep-link invites in `/syndicate create` print the slug and instruction (`/start syn_<slug>`) instead of a `t.me/...` URL — WhatsApp has no equivalent of Telegram deep-links.
- **Different on WA**: outbound text is run through `renderForWhatsApp` to strip backtick-code (WhatsApp doesn't render it) and flatten `[text](url)` markdown links to plain `text url`. `*bold*` passes through (WhatsApp renders it natively).

If `AIVA_WA_SESSION_ID` or `AIVA_WEBHOOK_SECRET` is missing, the bot logs
`aiva-wa webhook disabled` and Telegram keeps working as before.

### 10. Optional — registering a fresh per-syndicate bot (Option B)

Not implemented in v0. When the syndicate count justifies the toil:

1. The syndicate operator sends `/newbot` to BotFather manually.
2. They paste the new token into our admin dashboard.
3. We boot a second `Bot` instance with that token in the same process
   (grammY supports many bots per process — see `bots/syndicate-factory.ts`
   for the seam).
4. Webhook URL pattern: `bot.vtourn.com/v1/telegram/webhook/<bot-id>`.

Tracked as `IDEAS.md → "Per-syndicate fresh bots"`.

---

## Architecture (one diagram)

```
   Telegram                          WhatsApp (via Aiva gateway)
       │                                       │
       │  POST /v1/telegram/webhook            │  POST /v1/webhooks/aiva-wa
       │  (X-Telegram-Bot-Api-Secret-Token)    │  (X-Signature: sha256=<hex>)
       ▼                                       ▼
                Fastify (apps/tournament-bot, :3350)
                            │
                            ▼
                lib/dispatch.ts  ── single source of truth for command logic
                            │
                            ▼
                    Storage (SQLite tg.db)
                            │
                            ▼
                    apps/api (odds, leaderboard, bracket — HTTP)

   ──────── outbound push ────────

   Game-state event   ──► push/{market-move,lock-mult-expiry,kickoff,goal,affiliate-cta}
                       ──► rate-limit.shouldSendPush()
                       ──► bot.api.sendMessage()
                       ──► Telegram
```

## Commands

| Command | Behaviour |
|---|---|
| `/start` | Onboard. Routes `syn_<slug>` / `login_<code>` / `invite_<id>` deep-link payloads. |
| `/picks` | Deep-link to the bracket. Prompts to pair if not linked. |
| `/odds team:argentina` | Hits `apps/api`'s odds endpoint, renders Polymarket implied prob. |
| `/leaderboard [scope]` | Top 10 + your rank. Scopes: `global`, `country`, `friends`, `week`. |
| `/syndicate create <slug> <name>` | Create. User must be paired. |
| `/syndicate join <slug>` | Join. |
| `/syndicate leave <slug>` | Leave. |
| `/syndicate list` | Your syndicates. |
| `/help` | Lists everything. |

## Push helpers

Every push goes through `rate-limit.shouldSendPush()`:

1. Per-category opt-in check.
2. Quiet-hours check (per-user TZ; bypassed for kickoff/goal during a match).
3. 3/day cap (bypassed for `notify_match_day` users *only* during a match
   window).

Affiliate CTAs additionally check `country_code` against
`AFFILIATE_BLOCKED_COUNTRIES` (default `NZ,AU`).

| Helper | Trigger | Match-window quiet-hours bypass? |
|---|---|---|
| `sendMarketMovePush` | Pick prob moved ±5pp | no |
| `sendLockMultExpiryPush` | Lock multiplier band drop in 24h | no |
| `sendKickoffPush` | T-0:05 to a relevant match | yes |
| `sendGoalPush` | Goal in a relevant match | yes |
| `sendAffiliateCtaPush` | Pre-match / post-event affiliate CTA | no |

## Storage schema

See [`src/storage.ts`](src/storage.ts). Three tables:

- `tg_user` — `chat_id` ↔ `user_id`, prefs, push counters.
- `syndicate` — slug, name, owner, format, privacy.
- `syndicate_member` — membership + role.

WAL mode + `PRAGMA foreign_keys = ON`.

## Tests

```bash
pnpm test
```

Vitest, ~50 tests covering:

- storage CRUD + foreign-key enforcement
- rate-limit policy (quiet hours, daily cap, match-window bypass, opt-out)
- every command path (start variants, picks, odds, leaderboard, syndicate
  sub-commands, help, free-form)
- push helpers (market-move copy, kickoff bypass, goal bracket-signal, geo
  gate for Polymarket vs pay-TV)
- deep-link payload parsing

## Operational notes

- **Don't commit `.env` or `tg.db`.** Both are in `.gitignore`.
- **Rotate `TELEGRAM_WEBHOOK_SECRET` quarterly.** Re-run step 5 after rotation.
- **Telegram drops updates** older than 24h if the webhook is unhealthy.
  Health-check `GET /v1/telegram/health` from your monitor.

## Open questions for Tim

1. **Bot username** — `@VTournBot`, `@VTourn2026`, `@VTournHQBot`? Doc 13 used
   the working name `@SimSportsBot` from a pre-rebrand draft. Pick before
   running BotFather step 1; renaming costs us the deep-link history.
2. **Option B (per-syndicate bots)** — confirm Option A (deep-link) is fine
   for v0 and Option B waits until syndicate count > N (50? 100?).
3. **Announcements channel** — `@VTournAnnounce` for tournament-wide
   broadcasts (doc 13 § Channels and groups). Not in this PR.
