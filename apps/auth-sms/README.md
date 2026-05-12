# @vtorn/auth-sms

Phone-number-only auth for Tournamental: user enters phone, gets a 6-digit
OTP via SMS or WhatsApp, enters the code, becomes a logged-in user.
No password, no recovery email, no Telegram requirement (Telegram
remains the recommended primary path per
[doc 13](../../docs/13-telegram-bot-and-auth.md), but this service is
the fallback for users who want phone-number identity).

## SMS / WhatsApp gateway

The default gateway is the [Aiva SMS gateway](https://github.com/) (a
self-hosted SMS + WhatsApp relay). Any other gateway that implements the
same request shape can plug in by overriding `AIVA_SMS_API_URL`. The
relevant client lives in `packages/aiva-client/`.

## Endpoints

### Outbound flow (website asks us to send a code)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/auth/request` | Send a 6-digit OTP. Body `{ phone, channel }` (`channel`: `sms` or `whatsapp`). |
| `POST` | `/v1/auth/verify`  | Verify the OTP. Body `{ phone, code }` → `{ jwt, user }`. |
| `GET`  | `/v1/auth/me`      | Resolve the JWT to the authed user. |
| `POST` | `/v1/auth/session/refresh` | Rotate the session. |
| `POST` | `/v1/auth/session/logout`  | Revoke the current session. |
| `GET`  | `/v1/auth/whatsapp/pairing-qr` | Operator-only HTML page with the latest WhatsApp pairing QR code. |
| `GET`  | `/health` | Liveness probe. |

### Inbound flow (user messages us first, Aiva gateway calls us)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/auth/inbound-login` | **Gateway-callable.** Body `{ phone, channel }` + header `x-inbound-secret`. Generates a 6-digit code + 32-byte magic token, returns `{ success: true, code, magicToken }`. |
| `POST` | `/v1/auth/magic-verify`  | **Front-end-callable.** Body `{ token }`. Mints a session and sets `tnm_session` cookie on `.tournamental.com`. |
| `POST` | `/v1/auth/verify-by-code` | **Front-end-callable, code paste fallback.** Body `{ code }`. Scans active OTP rows, matches by HMAC, mints a session. |

The inbound flow starts when the user messages the keyword `login` to
one of our WhatsApp / SMS numbers (operated by the
[Aiva SMS gateway](https://aiva.nz)). The gateway recognises the
keyword, POSTs to `/v1/auth/inbound-login`, and forwards our reply
(code + one-tap magic link) back to the user.

See [`docs/inbound-login.md`](./docs/inbound-login.md) for the full
request/response shapes, security model, and gateway-integration
contract.

## Quick start (dev)

```bash
pnpm install
cp ../../.env.example apps/auth-sms/.env  # then fill in:
#   AUTH_OTP_SECRET=<32+ random bytes hex>
#   AUTH_JWT_SECRET=<32+ random bytes hex>
#   AUTH_ADMIN_TOKEN=<random>
#   AIVA_SMS_API_KEY=<from your SMS gateway>
#   AIVA_SMS_DEVICE_ID=<your Android device UUID>
#   AIVA_WA_SESSION_ID=<from your SMS gateway>
pnpm --filter @vtorn/auth-sms dev
```

The service binds to `:3330` by default. Override with `AUTH_PORT`.

If `AIVA_SMS_API_KEY` / `AIVA_WA_SESSION_ID` are not set the service
falls back to **stub senders** that log the OTP to stdout. This is
**dev only** — the service refuses to mint JWTs in production unless
`AUTH_OTP_SECRET` and `AUTH_JWT_SECRET` are at least 32 chars.

## Curl examples

```bash
# 1. Request OTP via SMS
curl -X POST http://localhost:3330/v1/auth/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+6421999000","channel":"sms"}'
# → { "ok": true, "channel": "sms", "phoneMasked": "+64*****000", "expiresInSeconds": 600 }

# 2. Request OTP via WhatsApp
curl -X POST http://localhost:3330/v1/auth/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+6421999000","channel":"whatsapp"}'

# 3. Verify (using the code from the SMS / WhatsApp message)
curl -X POST http://localhost:3330/v1/auth/verify \
  -H 'content-type: application/json' \
  -d '{"phone":"+6421999000","code":"123456"}'
# → { "ok": true, "jwt": "...", "user": { "id": "u_...", "phone": "+6421999000", ... } }

# 4. Use the JWT
curl http://localhost:3330/v1/auth/me \
  -H "authorization: Bearer $JWT"
```

## Architecture

```
┌───────────────────────────────────────────────────┐
│ apps/auth-sms (Fastify, :3330)                    │
│                                                   │
│  routes/request-otp.ts ── rate-limit ── otp.ts ──▶ Aiva SMS gateway
│                                                ──▶ Aiva WA gateway / Baileys
│                                                   │
│  routes/verify-otp.ts  ── otp.ts ── jwt.ts ─────▶ session row in SQLite
│                                                   │
│  routes/session.ts     ── jwt.ts ── storage.ts ─▶ revocation check
└───────────────────────────────────────────────────┘
                                  │
                                  ▼
                       SQLite (./data/auth.db)
                       Tables: phone_otp, user, session, rate_limit
```

### Why SQLite

This is a single-instance auth service with low write rate (one row
per OTP request, deleted on verify). better-sqlite3 is synchronous,
millisecond-fast, zero-ops, and survives process restarts. If we
ever shard out we'll move to Postgres per the rest of the stack.

### Why Aiva SMS as the primary WhatsApp transport

Tournamental runs its own dedicated number, `+64204259096`, which
serves both WhatsApp inbound-login and SMS inbound-login (NZ + AU
only on the SMS leg). The number is not shared with any other
product. The Aiva SMS gateway (see [aiva.nz](https://aiva.nz))
handles the underlying Baileys WhatsApp session and the SMS SIM
behind a single HTTP API, which means we:

1. Don't run a second Baileys process competing for the SIM.
2. Get the gateway's auto-reconnect / QR-rotation handling for free.
3. Get one webhook surface (`/v1/auth/inbound-login`) for both
   channels, with the channel field (`sms` or `whatsapp`) preserved
   on the OTP row.

If you fork Tournamental and want to run your own number entirely
in-process, set `WHATSAPP_TRANSPORT=baileys` and visit
`/v1/auth/whatsapp/pairing-qr` (with `X-Admin-Token`) to scan a
fresh WhatsApp pairing once.

## Rate limits

| Window | Subject | Limit |
|--------|---------|-------|
| 60s    | per phone | 1 OTP request |
| 1h     | per phone | 5 OTP requests |
| 1h     | per IP    | 30 OTP requests |
| per OTP | (verify) | 5 wrong attempts |

A 429 response includes a `Retry-After` header and a `reason` field
(`phone-cooldown` / `phone-hourly` / `ip-hourly`).

## Tests

```bash
pnpm --filter @vtorn/auth-sms test           # vitest run
pnpm --filter @vtorn/auth-sms test:watch     # iterative
pnpm --filter @vtorn/auth-sms typecheck
```

Coverage:
- `otp.test.ts` — code generation, hashing, WebOTP body format.
- `rate-limit.test.ts` — cooldown, phone hourly, IP hourly.
- `storage.test.ts` — SQLite roundtrips for OTP / user / session.
- `jwt.test.ts` — sign / verify / tamper / expiry.
- `phone.test.ts` — E.164 normalisation + masking.
- `routes.test.ts` — full request → verify → /me → refresh → logout flow.

## Privacy + compliance

See [docs/32-auth-and-privacy.md](../../docs/32-auth-and-privacy.md)
for the full GDPR + NZ Privacy Act 2020 posture, retention windows,
and at-rest encryption options.

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/auth-sms.openapi.json`](../../docs/api/auth-sms.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/auth-sms run dump-openapi
# or @tournamental/odds-ingest / @vtorn/wc2026-data-scripts
```
