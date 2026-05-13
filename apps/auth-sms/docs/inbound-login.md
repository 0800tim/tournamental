# Inbound-login flow

The user signs in by sending the keyword `login` to one of our public
WhatsApp / SMS numbers. The
[Aiva SMS gateway](https://aiva.nz) running on a dedicated handset
sees the inbound message, calls our service with the user's phone
number, gets back a 6-digit code + a one-tap magic-link token, and
sends that as the outbound reply. The user either taps the link
(consumed at `https://play.tournamental.com/?v=<token>` by the magic-link
script in `apps/marketing/src/layouts/Layout.astro`) or pastes the
code at [`/sign-in`](https://tournamental.com/sign-in).

This complements the outbound flow (`/v1/auth/request` + `/v1/auth/verify`)
where the website asks us to *send* an OTP. The two flows share the
`phone_otp` storage so they cannot be active simultaneously against
the same phone — in practice they never need to be.

## Why the design is shaped this way

- **WhatsApp is the default.** Free worldwide, end-to-end encrypted,
  no SMS interconnect fees. SMS is supported but only for users in NZ
  + AU (where our gateway holds local SIMs).
- **The user initiates contact, not us.** Inbound is friendlier than
  asking the user to type their number into a form — they already
  trust their messaging app, they're already on their phone, and
  there's nothing to mistype.
- **One-tap magic link AND 6-digit code.** Users on the device that
  received the reply can tap and they're in. Users signing in on a
  different device (received on phone, signing in on desktop) paste
  the code.
- **Apex cookie.** The session cookie is set on `.tournamental.com` so
  both `tournamental.com` (the marketing site) and
  `play.tournamental.com` (the bracket app) see it.

## Wire contract

### `POST /v1/auth/inbound-login` (gateway → us)

```http
POST /v1/auth/inbound-login HTTP/1.1
Host: auth.tournamental.com
Content-Type: application/json
x-inbound-secret: <shared secret from INBOUND_LOGIN_SECRET env var>

{ "phone": "+6421000000", "channel": "whatsapp" }
```

Success response (`200`):

```json
{ "success": true, "code": "482910", "magicToken": "abcdef..." }
```

`magicToken` is 64 hex chars (32 bytes of entropy). It is single-use,
expires 5 minutes after issuance (configurable via
`AUTH_OTP_TTL_SECONDS`), and is consumed atomically by
`/v1/auth/magic-verify`.

Error responses:

- `400 { error: "bad-body" | "bad-phone" }`
- `401 { error: "bad-secret" }`
- `429 { error: "rate-limited", retryAfterSeconds: 60, reason: "phone-cooldown" | "phone-hourly" }`

The per-phone rate limits are the primary SMS / WhatsApp flood
defence: an attacker cannot use our gateway to spam a victim's phone
because we enforce a 60-second cooldown between requests for any
single number, plus a 5-per-hour cap. The per-IP cap is intentionally
disabled on this endpoint (the gateway is the only legitimate caller,
proven by the shared secret).

### `POST /v1/auth/magic-verify` (browser → us)

Called by the magic-link consumer script when the user lands on
`https://play.tournamental.com/?v=<token>` (or whatever
`MAGIC_LINK_BASE_URL` is set to on the auth-sms host).

```http
POST /v1/auth/magic-verify HTTP/1.1
Host: auth.tournamental.com
Content-Type: application/json
User-Agent: <browser UA>
Accept-Language: <browser language>

{ "token": "abcdef..." }
```

Success response (`200`) sets a `Set-Cookie: tnm_session=...; Domain=.tournamental.com; ...`
header and returns:

```json
{
  "jwt": "<JWS>",
  "expiresAt": 1234567890,
  "user": { "id": "u_...", "phone": "+6421000000", "displayName": null, "country": null }
}
```

Error responses:

- `400 { error: "bad-body" }`
- `401 { error: "unknown-or-expired" }` (token not found, expired, or per-code attempt cap reached)
- `403 { error: "fingerprint-mismatch" }` (a different device tried the same token after first-use binding)

### `POST /v1/auth/verify-by-code` (browser → us)

Code-paste fallback. No phone number required.

```http
POST /v1/auth/verify-by-code HTTP/1.1
Host: auth.tournamental.com
Content-Type: application/json
User-Agent: <browser UA>
Accept-Language: <browser language>

{ "code": "482910" }
```

Success response is identical to `/v1/auth/magic-verify`.

Error responses:

- `400 { error: "bad-body" }` (code must be exactly 6 digits)
- `401 { error: "unknown-or-expired" }` (no active OTP matches this code, or row is exhausted)
- `403 { error: "fingerprint-mismatch" }` (row was bound on first use to a different IP/UA)
- `429 { error: "ip-throttled", retryAfterSeconds: <int> }` (this IP has submitted too many no-match attempts; the bucket fires ONLY on blind-guessing, not on legitimate verifies)

## Security model

The Tournamental inbound-login flow has a deliberately different rate-
limiting posture from the outbound flow, because a typical
Tournamental user is on a shared office / school / cafe NAT alongside
many other users.

| Layer | Mechanism | Tuning |
|-------|-----------|--------|
| 1 | Per-code attempt cap | 5 wrong tries against the same OTP row burns the row. IP-independent. The primary brute-force defence. |
| 2 | IP + UA fingerprint binding | On *first use* (not at issuance — the user requests via phone, verifies via desktop). Subsequent attempts from a different IP/UA fingerprint are rejected as `fingerprint-mismatch`. |
| 3 | Per-IP no-match cap | Only counts verify-by-code attempts that match *no* active OTP. Generous (default 60 / OTP-TTL window). A shared NAT with 20+ legitimate users never trips it because their successful verifies don't bump the counter. |
| 4 | Per-phone cooldown | 60 seconds between inbound-login requests for the same phone. Prevents SMS / WhatsApp flooding of any one victim. |
| 5 | Per-phone hourly cap | 5 inbound-login requests per phone per hour. Prevents sustained flooding. |
| 6 | Single-use OTP rows | Successful verify deletes the row before returning. Token / code cannot be replayed. |
| 7 | Apex-domain session cookie | `HttpOnly`, `Secure`, `SameSite=Lax`. Single CSRF surface across the two sub-domains. |

Layers 1–3 are what diverge from the outbound flow. Layers 4–7 are
shared.

### Why not per-IP rate-limit the verify endpoints

Because a single office NAT may have 20+ users signing in within
minutes of a launch email. A naive per-IP cap (e.g. 10 / 10 minutes)
locks them out. Instead, we cap the *no-match* failure rate per IP,
which only catches the blind-guessing pattern (an attacker submitting
random 6-digit codes that match no active OTP). Successful and
matched-but-fingerprint-mismatched attempts pass through cleanly.

### Why we bind on first use, not at issuance

The user typically requests the code on their phone (the device
sending the WhatsApp / SMS message) and verifies on a different
device (their desktop browser, or a TV via QR code). Binding at
issuance would block the legitimate cross-device path entirely.

By binding on *first use* instead, we still close the
intercepted-link attack window: if an attacker steals the magic
token, they have to be the first device to use it, and the
legitimate user's subsequent attempt will fail with
`fingerprint-mismatch` and immediately tell them their token was
intercepted.

## Gateway hand-back

For the Aiva SMS gateway operator wiring this up:

| Thing | Value |
|-------|-------|
| Endpoint base URL | `https://auth.tournamental.com` (prod) — the auth-sms service on port 3330 behind a Cloudflare tunnel |
| Method + path | `POST /v1/auth/inbound-login` |
| Auth header | `x-inbound-secret: <INBOUND_LOGIN_SECRET>` — value handed back out-of-band; see `apps/auth-sms/.env` |
| Request body | `{ "phone": "+E164", "channel": "sms" \| "whatsapp" }` |
| Response | `{ "success": true, "code": "<6 digits>", "magicToken": "<64 hex>", "magicLinkUrl": "<full URL>" }` |
| Trigger keywords (recommended) | WhatsApp: `login`, `hi`, `hey`. SMS: `login`. Case-insensitive. |
| Channels | WhatsApp (worldwide) + SMS (NZ + AU only — fall back to WhatsApp prompt for other countries) |

Suggested reply template (preferred — uses `magicLinkUrl` verbatim so
the destination is controlled server-side via the
`MAGIC_LINK_BASE_URL` env var, default `https://play.tournamental.com/`):

```
Your Tournamental login code is: *{code}*

Tap to sign in instantly:
{magicLinkUrl}

Or enter the code on the website. Expires in 5 minutes.
```

Legacy gateways that hardcoded the URL template can keep working by
composing `<your-base>?v={magicToken}` — the `magicToken` field stays
in the response for backwards compatibility — but new integrations
should paste `magicLinkUrl` verbatim so any future change to the
landing surface (e.g. a native-app deep-link) only requires an env
var bump on the auth-sms side.

The gateway should suppress the magic-link line if neither
`magicLinkUrl` nor `magicToken` is present in the response (which
would only happen during a degraded state on our end — not the
normal path).

## Operational notes

- The endpoint is disabled when `INBOUND_LOGIN_SECRET` is empty (the
  service returns 401 on every call). Rotate the secret via the env
  file and a service restart.
- The session cookie domain is `.tournamental.com`. Sub-domains
  (`play.tournamental.com`, `auth.tournamental.com`, etc) all read
  the same cookie. Set `INBOUND_COOKIE_DOMAIN` to override for
  dev / staging.
- Per-code attempt counter (`magic_attempts`) is independent from the
  legacy per-phone failure lockout (`attempts`). They cannot interfere
  with each other.
- The `phone_otp` schema was extended in v0.3 to add `challenge`,
  `bound_ip`, `bound_ua_fp`, `magic_attempts`. The migration is
  non-destructive `ADD COLUMN`; legacy rows (which have `challenge IS
  NULL`) are not visible to the inbound-flow endpoints because they
  filter on `challenge IS NOT NULL`.
