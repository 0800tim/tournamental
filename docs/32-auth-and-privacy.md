# 32, Auth (SMS / WhatsApp) and Privacy

> **Update 2026-05-12, production trust model is now Supabase Auth.**
> The bespoke `apps/auth-sms` service described below is **legacy**:
> kept around for the SMS-OTP flow during the hand-over but slated for
> retirement once the Supabase rollout (see [doc 52](52-supabase-setup.md))
> is bedded in. The dev-trust `X-User-Id` header still works in lower
> environments behind `GAME_DEV_AUTH=1`; production validates Supabase
> JWTs via the `Authorization: Bearer <token>` header.
>
> Read [doc 52](52-supabase-setup.md) first. The privacy posture below
> still applies (data minimisation, retention, GDPR / NZ Privacy Act).

> Phone-number-only OTP login service (`apps/auth-sms`) sits alongside
> the Telegram-first auth from [doc 13](13-telegram-bot-and-auth.md)
> and the social / passkey paths from [doc 20](20-identity-humanness-bots.md).
> This doc covers the privacy posture for phone-number-as-identity.

## Why a phone-number path at all

Telegram bot auth is the recommended primary identity per doc 13.
But there are users who:

- Don't want to install Telegram (or are in markets where Telegram
  is less common, e.g. India, Indonesia, parts of LATAM).
- Want a simpler "got the code, type the code" flow on first contact.
- Are signing up via a marketing landing page where a phone-number
  field is cheaper friction than a deep-link to Telegram.

Phone OTP is the lowest-common-denominator global identity: every
phone in our target markets can receive an SMS or a WhatsApp message.

We deliberately do *not* rely on third-party SMS providers (Twilio,
Vonage). Tournamental already runs the **Aiva SMS gateway** at sms.aiva.nz
which delivers SMS via Android phones over FCM and WhatsApp via
Baileys. Per-OTP cost is effectively zero, which keeps the
free-to-play promise intact.

## Service surface

`apps/auth-sms/` exposes (port 3330; behind Cloudflare on
`auth.tournamental.com` and dev `vtorn-auth.aiva.nz`):

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/auth/request` | Request a 6-digit OTP via SMS or WhatsApp. |
| `POST` | `/v1/auth/verify`  | Submit the code; mint a 30-day JWT. |
| `GET`  | `/v1/auth/me`      | Resolve the JWT to a user record. |
| `POST` | `/v1/auth/session/refresh` | Rotate the session JWT. |
| `POST` | `/v1/auth/session/logout`  | Revoke the current session. |
| `GET`  | `/v1/auth/whatsapp/pairing-qr` | (Operator-only) one-time WA pairing QR. |

`/health` returns `{status:"ok"}` with `Cache-Control: no-store`.

## Data model

SQLite (`apps/auth-sms/data/auth.db`). Three tables:

```sql
phone_otp (phone PK, otp_hash, channel, attempts, expires_at, created_at)
user      (id PK, phone UNIQUE, display_name?, country?, created_at, last_seen_at)
session   (id PK, user_id, jwt_jti UNIQUE, created_at, expires_at, user_agent?, ip?)
```

Plus a `rate_limit` table (key, bucket_start, count) for fixed-window
rate-limit counters.

### What is PII

- **Phone number (E.164)**, direct identifier. Stored on the `user`
  row. Returned to the user (their own row) via `/v1/auth/me` only.
- **IP address**, pseudonymous identifier, retained on the `session`
  row for security review. Auto-deletes when the session expires.
- **User agent string**, pseudonymous, retained on the session row.

Truncated SHA-256 of the phone (first 12 hex chars) is used in logs
for correlation; raw phone numbers never appear in logs.

### Retention

| Data | Retention | Trigger |
|------|-----------|---------|
| `phone_otp` row | 10 minutes (TTL) or until used | OTP TTL or successful verify |
| Failed verify attempts on an OTP | 10 minutes (with the row) | OTP TTL |
| `session` row | 30 days max | JWT exp + manual logout |
| `user` row | indefinite while account active | account deletion request |
| Rate-limit buckets | 2 hours | opportunistic prune on each request |
| Pino logs | 30 days on the host | logrotate |

### Account deletion

Any user can email `support@tournamental.com` requesting account deletion.
SLA: 30 days per GDPR. Operator runs:

```sql
DELETE FROM session WHERE user_id = $1;
DELETE FROM user    WHERE id = $1;
```

OTP rows are auto-pruned. Logs are rotated within 30 days.

## At-rest encryption

The default SQLite file is plain on disk. Two options for production
hardening:

1. **sqlcipher** (recommended for prod). The auth service is built
   against `@journeyapps/sqlcipher` (drop-in replacement for
   better-sqlite3) and `AUTH_SQLITE_KEY` is set at boot from the
   secret store. Fully transparent, no code changes, but ties us
   to a non-trivial native dep.
2. **Disk-level encryption** (sufficient for small deployments). The
   host runs LUKS / FileVault / BitLocker; no app-level changes.

For v0.1 we ship the plain SQLite path with disk-level encryption on
the deployment host. SQLCipher is on the post-launch hardening list
(IDEAS.md).

## In-transit encryption

All public traffic is HTTPS via Cloudflare. The internal
auth-sms ↔ Aiva gateway hop is HTTP within the dev box's localhost,
and HTTPS otherwise.

## Threat model and mitigations

| Threat | Mitigation |
|--------|------------|
| OTP brute force | 6-digit code (1M space) + 5-attempt cap + 10-min TTL = 1 in 200k odds before lockout, then 0. |
| OTP replay | Single-use; deleted on successful verify. |
| OTP intercept (SIM swap, SS7) | Out of our threat model for v0.1; users with high-value accounts will be encouraged to add TOTP / passkey per doc 13. We never make this service a high-value money path. |
| Phone enumeration via timing | All verify branches do an HMAC compute + constant-time compare, even when the OTP row doesn't exist. |
| Mass account creation (bots) | Per-IP rate limits + per-phone rate limits + verify-attempt limits. The Humanness Score from doc 20 then labels the resulting accounts. |
| JWT theft | 30-day expiry, server-side revocation list (`session` table). Logout / refresh both revoke the old JTI. |
| Stolen DB → offline brute force | OTP hashes are HMAC-SHA-256 with a server-side secret bound to phone+channel. Without the secret, no brute force. |
| Stolen DB → phone harvesting | Mitigated by sqlcipher in prod; partially mitigated by host disk encryption otherwise. |
| Aiva SMS / WhatsApp gateway compromised | The gateway never sees the phone in our DB unless an OTP is in flight; the OTP itself is single-use. Worst case: a window of impersonation while the breach is open. |

## Compliance posture

### GDPR (Art. 5–7, 13, 17, 32)

- **Lawful basis**: legitimate interest + consent at signup.
- **Purpose**: account creation, login, prediction-game state.
- **Data minimisation**: phone is the only identifier; no email, no
  postal address, no birthday.
- **Right of access**: `/v1/auth/me` returns everything we hold for
  the user.
- **Right of erasure**: 30-day SLA on email request.
- **Right of portability**: out of scope for v0.1; bracket data is
  exportable via the public API once it ships.
- **Security**: HMAC-protected OTP hashes, JWT signed with HS256,
  rate limits, server-side revocation, host disk encryption.

### NZ Privacy Act 2020 (IPP 1–13)

- **IPP 1 (purpose)**: phone is collected for login only.
- **IPP 5 (storage and security)**: SQLite with HMAC + host
  encryption + per-OTP rate limits.
- **IPP 6 (access)**: `/v1/auth/me`.
- **IPP 7 (correction)**: not applicable to phone, user can re-verify
  with a new number, old account flagged for deletion.
- **IPP 9 (retention)**: indefinite while active, deleted on request.
- **IPP 12 (cross-border)**: data lives on a NZ-based host; Aiva SMS
  gateway is also NZ-based.

## Privacy notice (user-facing copy)

To be embedded in the auth page footer link "Privacy":

> When you sign in to Tournamental with a phone number, we store your phone
> number, the device you signed in from, and the time of last
> activity. We use it only to log you in and to send you predictions
> reminders if you opt in. We never sell your data. To delete your
> account, email support@tournamental.com, we'll process it within 30
> days.

## TOS notice (user-facing copy)

To be added to the existing TOS doc:

> Phone-number sign-ins use SMS or WhatsApp. Standard rates from your
> carrier may apply for SMS. We send a one-time code to verify it's
> you; we never call your phone, and we never share the number with
> third-party advertisers.

## Open questions

- **Which Aiva SMS device ID** is allocated for Tournamental?, see
  Tim's existing Sdeal device list. We may want a dedicated device
  to keep the SMS history separate.
- **Which Aiva WhatsApp session** does Tournamental use?, Sdeal's
  `+64204259069` is the existing session. Decision: reuse it for
  v0.1 with a different sender display name, or stand up a new
  session on a fresh number.
- **Do we add Africa / India SMS routing** for cost, current Aiva
  gateway routes via Tim's NZ Android phone, fine for sub-NZ scale
  but will need international SMS termination at scale.
