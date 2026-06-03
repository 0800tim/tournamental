---
date: 2026-06-04
agent: orchestrator
status: completed
branch: feat/phone-link-via-whatsapp
---

# Add phone to email-OTP account via inbound WhatsApp

## Why

Email-OTP-signed-up users had no clean way to add a phone number to
their account. The Mobile field on the profile was inert ("contact
support to change it"). Tim 2026-06-04: "they should just click a
button to say Add phone number, which sends a login to our WhatsApp
and asks them to enter a one-time code. They only can send us a
message, then we pick it up from there. So they can't just punch it
in."

This protects the system from a separate hijack vector that came up
in the previous session: if the profile PATCH accepted a typed phone,
a signed-in user could overwrite their `user.phone` with someone
else's. The new design proves phone possession by requiring an
inbound WhatsApp message, exactly the same way the original sign-in
flow proves it.

## Design

```
ProfilePage  ─── click "Add phone" ───▶  PhoneLinkModal
   ▲                                          │
   │                                          │ tap green WA button
   │                                          ▼
   │                              wa.me/<our number>?text=login
   │                                          │
   │                                          ▼
   │                                  Aiva gateway sees inbound
   │                                          │
   │                                          ▼
   │   POST /v1/auth/inbound-login {phone, channel='whatsapp'}
   │                                          │
   │                                          ▼
   │                              auth-sms mints OTP + magic token,
   │                                  stores in phone_otp table
   │                                          │
   │                                          ▼
   │              gateway replies on WhatsApp with the 6-digit code
   │                                          │
   │                                          ▼
   └── user pastes code into PhoneLinkModal step 2
                                              │
                                              ▼
            POST /v1/auth/phone-link/verify {code}    (NEW endpoint)
                          │
                          ▼
                auth-sms scans active OTPs, matches by HMAC,
                gets {phone, channel} from the matching row,
                checks collision via getUserByPhone,
                UPDATE user SET phone=? WHERE id=authed.userId
                          │
                          ▼
                       200 + updated user
```

The new endpoint deliberately reuses the existing inbound-login flow
(`/v1/auth/inbound-login` + `phone_otp` table) and the existing
verify-by-code matching logic. The only difference is the final step:
instead of minting a fresh session for the phone's user (the
sign-in path), it attaches the verified phone to the
already-signed-in user.

## Surface area shipped

### Backend (`apps/auth-sms`)

- **`src/auth-middleware.ts`** (new), extracted the cookie-or-Bearer
  JWT verification + revocation check from `routes/session.ts` into
  a shared helper, so any route that needs the signed-in user can
  call `authenticate(ctx, req)` without duplicating logic.
- **`src/routes/session.ts`**, refactored to import the shared
  `authenticate`. No behaviour change.
- **`src/storage.ts`**, added `getUserByPhone(phone)`, mirrors
  `getUserByEmail`. The `user.phone` UNIQUE index makes it O(log n).
- **`src/routes/phone-link.ts`** (new), the new endpoint. Reuses the
  active-OTP scan + IP-throttle pattern from `verify-by-code`, adds
  a collision check before the UPDATE, returns 409 `phone-taken` on
  hijack attempt or 200 `alreadyLinked: true` on idempotent re-link.
- **`src/audit.ts`**, six new `phone-link.*` audit actions.
- **`src/index.ts`**, registers the new route.

### Frontend (`apps/web`)

- **`lib/auth/inbound-login.ts`**, added `linkPhoneByCode(code)`
  client helper. Also extended the `InboundUpdateErr` union to
  include `display-name-taken` (carry-over from PR #263).
- **`components/auth/PhoneLinkModal.tsx`** (new), two-step modal:
  step 1 is the green WhatsApp button (tap to open `wa.me/<num>?text=login`);
  step 2 is the 6-digit code input + Verify button. ESC closes,
  click-outside closes, in-flight guard against double-submits.
- **`components/auth/phone-link-modal.css`** (new), paired styling,
  reuses `.vt-signin-btn-whatsapp` from the existing sign-in modal.
- **`components/auth/ProfilePage.tsx`**, replaced the inert "contact
  support" phone field. When `serverUser.phone` is null the field
  shows blank + a green "Add phone" button that opens the modal.
  When the user has a phone, the read-only display stays as before.

## Security model

- The user never types their own phone number anywhere in the UI.
- Possession is proven exclusively by an inbound WhatsApp message,
  the same mechanism the sign-in flow uses.
- Server-side collision check + `user.phone` UNIQUE index together
  guarantee a phone can't be linked to two accounts. 409 `phone-taken`
  on hijack attempt; the other user keeps their phone.
- Idempotent re-link of an already-linked phone is a 200 no-op (no
  audit-log noise, no extra UPDATE).
- Per-IP no-match rate limit mirrors `verify-by-code` so an attacker
  can't side-step the cap by alternating endpoints. Bucket key is
  distinct (`phone-link-nomatch` vs `inbound-code-nomatch`) but the
  configured `inboundCodeIpFailureMax` cap applies to both.
- Authed-only: 401 without a valid session cookie / Bearer JWT.

## Pre-existing typecheck noise (not in this diff)

The same four pre-existing auth-sms typecheck errors flagged in PR
#263 are still present (`internal-link-phone.ts`, `telegram-link.ts`,
`magic-verify.ts` replay actions, `email-otp.ts` audit actions). All
predate this work. Worth a sweep PR later: extend `AuditAction` with
the missing email + replay actions and either implement or remove the
`linkPhoneToTelegramUser` / `linkTelegramToUser` storage methods. Not
blocking dev.

## Dev verification

After merge, on dev:

- [ ] Sign in as a fresh user via email-OTP (no phone on file).
- [ ] Visit /profile, see the new green "Add phone" button next to a
      blank Mobile field. Read-only field for users who already have
      a phone is unchanged.
- [ ] Click "Add phone" → modal opens, step 1 highlighted.
- [ ] Tap the green WA button → WhatsApp opens with "login" prefilled.
- [ ] Send the message → receive a 6-digit code on WhatsApp.
- [ ] Step 2 input → paste code → "Link phone" → modal closes, profile
      shows the phone, toast says "Phone linked ✓".
- [ ] Repeat with someone else's phone (or yours, again, in a second
      account) → should see "That phone is already linked to another
      account."
- [ ] Try wrong code → "That code does not match. Send a fresh login
      message and try again."

## Not deployed to prod

Per Tim's standing rule (`feedback_dev_first_then_prod`), wait for
sign-off before deploying to prod.
