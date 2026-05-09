# 13 — Telegram Bot and Auth

> Identity, notifications, and the centralised communications layer — all via a single Telegram bot. Free, global, low-latency, no SMS, no WhatsApp Business, no Messenger 24-hour-window pain. The bot is the *primary* surface; the web app is one of several clients on top of the same APIs.

## Why Telegram

Honest comparison of every option that was on the table:

| Channel | Cost / message | Global? | Identity built-in | Rich UI | Two-way | Notes |
|---------|----------------|---------|-------------------|---------|---------|-------|
| **Telegram Bot API** | **$0** | yes | yes (chat ID) | yes (inline keyboards, web app, mini-apps) | yes | the chosen path |
| SMS (Twilio etc.) | $0.01–0.10 per SMS, varies by country | yes | yes (phone) | text only | one-way mostly | prohibitive at global scale |
| WhatsApp Business | $0.005–0.07 per template msg + 24h reply window | yes | yes (phone) | medium | yes within 24h | Meta gatekeeping; not free |
| Messenger | $0 in 24h window only | partial (Meta accounts) | yes (FB ID) | yes | yes within 24h | 24h window kills async tournaments |
| Discord | $0 | yes | yes (Discord ID) | yes | yes | poor mobile push, niche audience |
| Email | ~$0 | yes | sort of | medium | sort of | latency, deliverability, no real-time push |
| Apple/FCM push | $0 | yes | needs app install | medium | one-way | requires native app |
| Slack | $0 in workspaces | partial | yes (Slack ID) | yes | yes | enterprise context only |

Telegram wins on every axis that matters for a free, global, real-time gamified product: zero per-message cost, no platform-mediated rate limits at our scale, robust API, mature inline-keyboard / web-app / mini-app surfaces, ubiquitous on mobile, and works in countries where Meta or US-flagged services are blocked.

## Bot persona — the Tournament Bot

A single bot identity hosts all interactions. Working name: `@SimSportsBot` (final name TBD; the agent owns `apps/tournament-bot/` per [doc 09](09-agent-task-breakdown.md)).

- **Avatar**: a stylized referee or commentator character — same art language as the in-scene avatars, recognisable across the app.
- **Voice / persona**: sharp, friendly, slightly cheeky. Templates live alongside the commentary templates so the bot's tone matches the in-scene commentary voice. Localised (English, Spanish, French, Arabic, Portuguese, Hindi for the WC2026 launch).
- **Name in chats**: "Tournament Bot" generic; configurable per deployment.

The persona matters because the bot is the user's *primary* relationship with the product. Every push notification, prediction confirmation, pool invite, badge unlock, clip share — it all comes from this one consistent voice.

## Architecture

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                    Tournament Bot (Node 20 / TS)                 │
   │                                                                  │
   │  ┌───────────────┐   ┌───────────────┐   ┌─────────────────────┐ │
   │  │ grammY        │   │ Inline keybds │   │ Telegram Web App    │ │
   │  │ (Bot API)     │   │ /predict, etc │   │ (Mini App)          │ │
   │  └───────┬───────┘   └───────┬───────┘   └──────────┬──────────┘ │
   │          └────────┬──────────┴──────────────────────┘            │
   │                   ▼                                              │
   │         ┌───────────────────┐     ┌────────────────────┐         │
   │         │ Auth + identity   │     │ Command router     │         │
   │         │ /start, OTC link  │     │ /predict /pool ... │         │
   │         └─────────┬─────────┘     └─────────┬──────────┘         │
   │                   └───────────────┬─────────┘                    │
   │                                   ▼                              │
   └──────────────────────────────  HTTP API  ────────────────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │ Game state service    │   shared with web,
                         │ (Redis + snapshotter) │   doc 12 backend.
                         └───────────┬───────────┘
                                     │
                                     ▼  CDN JSON (cached, public)
                         /v1/static/leaderboards/...
                         /v1/static/profiles/...
                                     ▲
                                     │
                                     │ pull every 10s
                                     │
                         ┌───────────────────────┐
                         │ Web app, mobile web,  │
                         │ partner integrations  │
                         └───────────────────────┘

  Push fan-out (the bot's job):

      Game state event (e.g. "your prediction resolved")
            │
            ▼
      Notification dispatcher  ───▶ Telegram sendMessage    (free)
                              ───▶ optional FCM/APNS push  (if web app installed as PWA)
                              ───▶ optional email digest   (low priority)
```

The bot is the *only* component that talks to Telegram. It exposes a small HTTP API to the web app (and any other clients) so a logged-in user can authorise actions through their bot session. State lives in Redis (gamification doc); the bot is stateless.

## Stack

- **Node 20+, TypeScript.** Same monorepo as the rest of the project.
- **[grammY](https://grammy.dev/)** — modern TS-first Telegram bot framework. Smaller and clearer than Telegraf, well-maintained.
- **Webhook mode** (not long-polling) — the bot exposes a public HTTPS endpoint, Telegram POSTs updates. Works behind Cloudflare Tunnels for the dev server.
- **Redis** — shared with the gamification layer. The bot reads/writes the same KV namespace.
- **No bot-specific database.** All state is in shared KV.

## Auth flow

Two paths supported. Both terminate in the same outcome: the user's `telegram_id` is mapped to a `user_id` in Redis (`user_by_tg:<telegram_id> → user_id`).

### Path A — One-time code (web → bot)

For users who land on the website first.

1. User visits the web app, clicks "Sign in with Telegram".
2. Web server generates a 6-digit one-time code, stores it in Redis under `otc:<code>` with a 5-minute TTL and the browser's session token.
3. Web shows the user the code and a deep link: `https://t.me/SimSportsBot?start=login_847291`.
4. User taps the deep link (or types the code into the bot manually).
5. Bot receives `/start login_847291`, looks up `otc:847291` in Redis, validates, and binds the user's `telegram_id` to the session token.
6. Web app polls `/api/auth/poll?session=...` once per second; when the binding lands, it gets a logged-in JWT.
7. Code is consumed; profile is created if first sign-in.

This works on any device including desktop browsers without Telegram installed (user picks up their phone, taps deep link, web continues).

### Path B — Telegram Login Widget

For users who are already in Telegram Web or have Telegram open. Embed the [Telegram Login Widget](https://core.telegram.org/widgets/login) on the sign-in page; user clicks it, Telegram returns a signed payload with the user's `telegram_id`, `first_name`, `username`, and `photo_url`. Verify the HMAC signature server-side (using the bot token as the secret) and we have an authenticated session.

Path B is faster but requires the user has clicked through Telegram's own permission UI once. We support both; the web app picks based on UA hint and falls back to A.

### Path C — Bot-first (mobile users)

For users who arrive via a friend's invite link.

1. Friend taps "Invite friends to play" in the web app or in their bot, gets a `https://t.me/SimSportsBot?start=invite_<their_user_id>` link.
2. New user taps it → opens Telegram with the bot prefilled.
3. Bot greets them, runs onboarding inline (name, country, team affinity), creates `user_id`, links `telegram_id`, and credits inviter.
4. New user is now signed in within the bot. If they later open the web app, Path A flow takes 2 seconds.

This is the highest-conversion path because there's no web friction.

### Sessions

A logged-in session is a JWT signed with our server key, valid for 30 days, refreshed on use. The bot can revoke a session by deleting the user's session record in Redis. No password reset because there is no password.

## Alternative auth paths (no Telegram)

Telegram bot is the recommended primary identity because it doubles as the free push channel. But a tournament prediction product needs to work for users who don't want Telegram — and we want zero per-user cost regardless of path. Three free alternatives, supported alongside Telegram:

### Email magic link

Universal fallback. User enters email, receives a one-tap link with a signed token, clicks → logged in. JWT issued. Implementation: Resend, Postmark, or self-hosted Postfix; cost ~$0–0.001 per email. Latency 5–60 seconds depending on provider deliverability. Best for desktop sign-ups where Telegram-deep-linking is awkward.

### TOTP (Google Authenticator, Authy, 1Password, etc.) — as 2FA on top of identity

TOTP (RFC 6238) is a shared-secret 6-digit-rotating-code standard. Every authenticator app on the planet implements it; it's free, offline, and doesn't lock the user to any vendor.

The thing to know: **TOTP is a second factor, not an identity**. The server still has to know which user is presenting the code. So the canonical flow is:

1. User authenticates via Telegram or email magic link (gives us a `user_id`).
2. In settings, user clicks "Enable 2FA". Server generates a TOTP secret, displays a QR code (`otpauth://totp/VTorn:tim@...?secret=...&issuer=VTorn`).
3. User scans with Google Authenticator. Codes start rotating in their app.
4. User confirms by typing one current code. Server stores the secret encrypted-at-rest.
5. On future logins (after the primary factor), server prompts for the current TOTP code. User types it. Done.

For users who *prefer* TOTP as their primary path on a particular device, we support a "TOTP-first login" — the user enters their username + current TOTP code; if both match (and they've previously enrolled), they're in. This is technically still username-as-identity + TOTP-as-credential, which is fine.

Recovery codes: at TOTP enrollment we generate 8 one-time recovery codes; the user is told to save them. Losing the device + the codes = account is recoverable only via the primary auth path (Telegram or email).

### Passkeys (WebAuthn / FIDO2)

Modern. Free. The most secure option. The user's browser/OS generates a public-key keypair bound to the site, stored in Apple Keychain / Google Password Manager / 1Password / a YubiKey. Login is biometric (Face ID, Touch ID, Windows Hello) or device PIN. Phishing-resistant by design.

Use it when available — every modern Safari, Chrome, Firefox, Edge supports it. Falls back to email magic link or Telegram on older browsers. Implementation: a small TS wrapper around `navigator.credentials.create()` and `.get()`; on the server side use [`@simplewebauthn/server`](https://simplewebauthn.dev/).

### What we land on

The auth picker on the web sign-in page offers, in this order:

1. **Sign in with Telegram** (recommended — also unlocks notifications and the bot). Path A / B / C from above.
2. **Email magic link** (no app required).
3. **Passkey** (offered when the browser supports it; one tap on supported devices).

After sign-in, the user can optionally **enable Google Authenticator (TOTP) 2FA** in profile settings. Once enabled, all future logins on new devices require both the primary factor and a TOTP code. Existing devices are remembered for 30 days.

This combo is fully free, works globally, has zero per-user cost, and gives users a choice of friction level. SMS is never on the menu.

## Bot commands

Designed for muscle memory and minimal typing. All have inline-keyboard variants for thumb-only use.

```
/start          — onboard, create profile, link account
/me             — show my profile card
/streak         — current streak + history
/predict        — submit predictions (inline keyboard for the next match)
/predict <m>    — for a specific match by short id
/odds           — current Polymarket / sportsbook odds for the live or next match
/leaderboard    — global / country / city / friends / team — picker
/pool new       — create a sweepstakes pool
/pool join <code> — join with invite code
/pool list      — pools I'm in
/friends        — friend list + invites
/share          — generate a shareable card of my last achievement
/clip           — get the latest 15s highlight clip
/help           — list commands
/lang <code>    — change language
/optout         — stop notifications (does NOT delete account)
```

Anything that takes a prediction comes back as an inline-keyboard tree:

```
[ Argentina win ] [ Draw ] [ France win ]
                                                ← user taps "Argentina win"
Now exact score:
  [ 1-0 ] [ 2-0 ] [ 2-1 ]
  [ 3-0 ] [ 3-1 ] [ 3-2 ]
  [ Other ]                                    ← "2-1"
First scorer:
  [ Messi ] [ Álvarez ] [ Di María ] [ Other ] ← "Messi"
Confirmed. ✅ Predictions locked at kickoff.
```

The whole flow is 3–4 taps. Compare to a sportsbook UI which is 8+ taps with login and confirmations.

## Telegram Mini App (the in-bot web view)

For more complex flows (browsing odds, exploring leaderboards, watching a clip), open a [Telegram Web App](https://core.telegram.org/bots/webapps) inside the chat. Telegram passes the user's verified ID + a signed init payload, so the mini-app is auto-authed without any sign-in step. UI is a stripped-down version of the full Next.js app, served from the same origin.

The mini app is *also* where the in-scene 3D match watches inside Telegram on mobile. Bandwidth-aware — defaults to 5s chunk CDN reads, falls back to a top-down sprite view if the device can't render WebGL2 at acceptable framerate.

## Notification fan-out

The notification dispatcher (`apps/tournament-bot/dispatcher/`) consumes events from the gamification service via a Redis pub-sub channel and sends Telegram messages. Subscribed users receive:

- **Match starting in 5 minutes** — gentle reminder with quick-predict inline keyboard.
- **Goal in a match you predicted** — live update with point delta.
- **Prediction resolved** — win/loss banner, badge unlock if applicable, share button.
- **Pool result settled** — "You finished 3rd in Sydney Office Sweepstakes — 🥉".
- **Friend overtook you** — "Ahmed just passed you on the leaderboard".
- **Daily digest** — opt-in summary at user's local 8am.

Rate-limit by user: max 5 messages per 30 minutes during live action, max 1 digest per day. Per-user notification preferences live in `user:<id>.notifications` JSON.

### Channels and groups

In addition to private DMs, the bot can post to:

- **Tournament announcements channel** (e.g. `t.me/SimSportsAnnounce`) — official updates, big news, headline highlight clips.
- **Country-specific channels** (e.g. `@SimSportsAR`) — country leaderboard standings, country-team highlights.
- **Custom group chats** — install bot in a group; group automatically becomes a private leaderboard for its members. Bot posts predictions, results, and clip highlights to the group during matches. This is the office-watercooler killer feature.

Group install flow: add `@SimSportsBot` to any group, type `/setup` once, the bot links the group ID to a private leaderboard and starts contributing.

## Sharing and viral loops

Every milestone ends with a one-tap share to **Telegram, WhatsApp, Facebook, Instagram, X**. The bot generates the shareable card (image), copies a tracking URL into the user's clipboard, and offers OS-native share intents on mobile. WhatsApp specifically gets a custom URL that triggers `whatsapp://send?text=...&link=...` so the chat opens with the card preview already loaded.

Telegram inline mode means you can type `@SimSportsBot my_streak` in any chat to immediately attach a card showing your current streak. Native viral surface.

## Languages

Localise messages via a single `i18n.json` keyed by command + locale. Top targets for World Cup 2026 launch: en, es, fr, ar, pt-br, hi, de, it, ja. Auto-detect from `update.from.language_code`; user can override via `/lang`.

## Operational surface

- **Bot-token rotation**: store as a 1Password / SOPS / sealed-secret. Rotate quarterly.
- **Webhook URL**: `https://api.simsports.example.com/tg-webhook` behind Cloudflare. Cloudflare verifies origin and forwards.
- **Observability**: every incoming update logged with `update_id`, latency to Redis, latency to outbound `sendMessage`. Drop notifications older than 60s on the floor (user already saw the result somewhere else).
- **Rate limits**: Telegram allows 30 msg/sec to the same chat, ~30 msg/sec sustained outbound globally. Dispatcher enforces a token bucket.

## Acceptance criteria

- [ ] User can sign up via Path A, B, or C in under 30 seconds wall-clock.
- [ ] Profile is created on first interaction; subsequent /start calls do not duplicate it.
- [ ] Predict-the-next-match flow takes ≤ 4 taps in the bot.
- [ ] Notification of a goal in a predicted match arrives within 5s of the event in the spec stream.
- [ ] Group leaderboard works out-of-the-box after `/setup` in a fresh group chat.
- [ ] Share intents work on iOS Safari, Android Chrome, Telegram Desktop, Telegram Web.
- [ ] Mini-app loads in under 2 seconds inside Telegram on mid-range mobile.
- [ ] Localised welcome message in es, fr, ar, pt-br, hi.

## What we deliberately don't build

- **A Telegram chatbot LLM**. The bot is a deterministic command router; an LLM dialog would inflate cost and add ambiguity for no UX win at this scope. (We *do* use an LLM in the video-ingest pipeline; see [doc 6](06-video-ingest.md). That's a different concern.)
- **Voice messages**. Possible later; not v0.1.
- **Stickers**. We can ship a Tournament Bot sticker pack as a viral asset, but it's not load-bearing.
- **Replies to general questions**. The bot ignores free-form text outside of explicit flows. Cheap, predictable, no surprises.

## Sources

- [grammY (TS Telegram bot framework)](https://grammy.dev/)
- [Telegram Bot API reference](https://core.telegram.org/bots/api)
- [Telegram Login Widget](https://core.telegram.org/widgets/login)
- [Telegram Web Apps (Mini Apps)](https://core.telegram.org/bots/webapps)
