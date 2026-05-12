# 2026-05-10 — Clawd — auth-sms / WhatsApp OTP

Status: ready-for-review

## Task

Build seamless phone-number registration for VTourn:
phone → 6-digit OTP via SMS or WhatsApp → entered code → registered + logged in.
No password.

Refs: docs/13, docs/20, docs/22, new docs/32.

## What landed

### `apps/auth-sms/` — new Fastify service on :3330

```
src/
  index.ts                   server bootstrap + DI wiring
  context.ts                 AuthContext (DI for routes)
  storage.ts                 better-sqlite3: phone_otp / user / session / rate_limit
  otp.ts                     6-digit OTP gen + HMAC-SHA-256 hash + WebOTP body format
  rate-limit.ts              Fixed-window: 1/min phone, 5/hour phone, 30/hour IP
  jwt.ts                     HS256 sign + verify (jose)
  phone.ts                   E.164 normalisation + masking
  sms-gateway.ts             AivaSmsClient + StubSmsClient
  whatsapp-baileys.ts        AivaWhatsAppClient (HTTP) + LocalBaileysClient + Stub
  routes/request-otp.ts      POST /v1/auth/request
  routes/verify-otp.ts       POST /v1/auth/verify
  routes/session.ts          GET /v1/auth/me, POST refresh, POST logout
  routes/whatsapp-pairing.ts GET /v1/auth/whatsapp/pairing-qr (admin)
test/  (54 tests, all passing — see below)
```

Default WhatsApp transport is the Aiva SMS gateway (so we reuse another internal product's
existing paired session). Setting `WHATSAPP_TRANSPORT=baileys` switches
to in-process Baileys with a dashboard QR endpoint for first-run
pairing.

### `apps/web/app/auth/`

Next.js client-rendered `/auth` page. Two-step form: phone + channel
selector → 6-digit code. Uses `autoComplete="one-time-code"` and the
WebOTP API (`navigator.credentials.get({otp:...})`) so iOS / Chrome
autofill works. On verify it stores the JWT in localStorage under
`vtourn_jwt` and redirects to `?next=` (default `/world-cup-2026`).

Self-contained CSS in `auth.css` — does not touch globals.

### `docs/32-auth-and-privacy.md` (new)

Full GDPR + NZ Privacy Act 2020 posture: data model, retention, threat
model, encryption options, account deletion SLA, user-facing privacy /
TOS copy.

### `docs/22-deployment-and-tunnels.md`

Added `auth.vtourn.com` (prod), `auth-dev.vtourn.com` (staging), and
`auth.tournamental.com → :3330` (dev) to the URL plan and port table.

### `.env.example` + `.gitignore`

- `.env.example` gains the AUTH_*, AIVA_SMS_*, AIVA_WA_* and
  BAILEYS_* sections.
- `.gitignore` excludes `apps/auth-sms/data/`, `apps/auth-sms/baileys-auth/`,
  and the SQLite WAL files.

## Verification

```bash
# Unit + integration tests
pnpm --filter @vtorn/auth-sms test
# → 54 passed (otp, rate-limit, storage, jwt, phone, routes)

# Strict typecheck
pnpm --filter @vtorn/auth-sms typecheck   # passes
pnpm --filter @vtorn/web typecheck        # passes (auth page included)

# Build
pnpm --filter @vtorn/auth-sms build       # passes
```

E2E: `apps/web/__tests__/e2e/auth-sms.e2e.spec.ts` covers the happy
path SMS flow, the wrong-code error path, and the rate-limit surface.
Run with `pnpm --filter @vtorn/web test:e2e` after `next dev -p 3300`.

## Curl reference

```bash
# 1. Request
curl -X POST http://localhost:3330/v1/auth/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+6421999000","channel":"sms"}'
# → 200 { "ok": true, "channel":"sms", "phoneMasked":"+64*****000", "expiresInSeconds":600 }

# 2. Verify
curl -X POST http://localhost:3330/v1/auth/verify \
  -H 'content-type: application/json' \
  -d '{"phone":"+6421999000","code":"123456"}'
# → 200 { "ok": true, "jwt":"...", "user": { "id":"u_..." } }

# 3. Use the JWT
curl http://localhost:3330/v1/auth/me \
  -H "authorization: Bearer $JWT"
```

## Decisions worth flagging

- **JWT is HS256 + revocable via SQLite.** RS256 + JWKS is a future
  swap when other services need to verify locally. For now the auth
  service is the only verifier.
- **OTP hash binds phone + channel + secret.** Stops a stolen DB
  becoming a rainbow-table replay across the user base.
- **Aiva gateway is the default WhatsApp transport.** Reuses the
  existing Aiva-hosted Baileys session; doesn't pair a second WhatsApp.
- **SQLite over Postgres.** Sub-ms reads + zero-ops; we already have
  the better-sqlite3 native binding. Postgres swap is straightforward
  if scale demands.
- **WebOTP autofill.** SMS body format is
  `Your VTourn code is 123456.\n\n@vtourn.com #123456` so iOS / Chrome
  surface the one-tap autofill chip.

## Open questions for orchestrator

1. **Aiva SMS device ID** — should VTourn share the Aiva device (the existing
   current device) or get its own?
2. **Aiva WhatsApp session ID** — reuse an existing internal Aiva session for
   v0.1, or pair a fresh number?
3. **At-rest encryption** — ship with disk-level encryption only, or
   add sqlcipher in v0.1.x? Tim signed off "disk-level for v0.1" in
   the design pack, but worth re-confirming pre-launch.
4. **Cloudflare tunnel ingress** — I added the URL plan to docs/22 but
   did NOT touch the tunnel config (remote-managed; Tim's standing
   rule). Orchestrator (or Tim) needs to run the API procedure in
   docs/22 §Cloudflare to add `auth.tournamental.com → :3330`.

## Out of scope (parked)

- Phone-number-as-2FA on Telegram-primary accounts (doc 20 humanness
  layering): future PR.
- Internationalisation of OTP message bodies: future PR; default is
  English-only.
- WhatsApp Business templated messages: not used; Baileys / Aiva
  transports send free-form text.
- SMS templated bulk send / scheduled OTPs: gateway supports it, we
  don't need it.

## Files touched

- `apps/auth-sms/**` (new)
- `apps/web/app/auth/**` (new)
- `apps/web/__tests__/e2e/auth-sms.e2e.spec.ts` (new)
- `docs/32-auth-and-privacy.md` (new)
- `docs/22-deployment-and-tunnels.md` (URL plan + port table)
- `.env.example` (AUTH_* / AIVA_* sections)
- `.gitignore` (auth-sms runtime state)
