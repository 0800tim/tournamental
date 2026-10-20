---
title: Security review, RWC 2027 register-interest flow
date: 2026-10-17
scope: apps/web/app/api/v1/register-interest/route.ts, apps/web/lib/register-interest/store.ts, apps/web/lib/register-interest/ghl.ts, apps/web/lib/rate-limit/in-memory.ts, apps/web/middleware.ts (archive host), apps/web/app/hub/RegisterInterestForm.tsx
status: fixes in the same branch; four items open for Tim
---

# Security review: register-interest (hub signup for RWC 2027)

The flow shipped in PR #333 with no tests. This review reads every
line on the path from the hub form to the SQLite row and the HighLevel
mirror, fixes what can be fixed in code, and lists what needs a
decision. Tests live in `apps/web/__tests__/register-interest/`
(66 tests). HighLevel is mocked at the module boundary and global
`fetch` is stubbed to throw, so no test can reach the network.

Severity is for this product: a free prediction game that will run a
prize draw on referral counts in 2027. Nothing here handles money or
passwords.

## What the flow does

1. The hub form posts JSON to `/api/v1/register-interest` on
   play.tournamental.com. Middleware refuses the POST unless the
   `Origin` header is a first-party origin (SEC-WEB-01).
2. The route rate-limits per IP, validates the fields, drops
   honeypot submissions with a fake success, and upserts a row keyed on
   (tournament, email) in game.db `register_interest`.
3. The row gets a 7-character invite code. `/i/<code>` lands on the hub
   with `?ref=<code>`, and a signup that carries a valid `ref` is
   attributed to that code.
4. The row is mirrored to HighLevel as a contact tagged
   `rwc2027_interest`. The push is best effort with a 3 second timeout
   and is retried the next time the same person submits.

## Findings

| Id | Finding | Severity | State |
| --- | --- | --- | --- |
| RI-01 | Response carried a `created` flag, so a caller could tell whether an email was already registered | Low | Fixed |
| RI-02 | A repeat submit for an existing email overwrote that person's name, country and phone, unauthenticated | Medium | Fixed |
| RI-03 | A repeat submit could set `referred_by_code` on an existing row, including to the person's own code, inflating referral counts | Medium | Fixed |
| RI-04 | Request body parsed with no size limit | Low | Fixed |
| RI-05 | `source_path` stored as free text | Low | Fixed |
| RI-06 | Rate limit is in memory, per process and per IP only | Low | Global brake added (`fix/register-interest-global-brake`); Turnstile open |
| RI-07 | Archive host blocked mutating methods but not the GET routes that write (signed approve and deny links for pool join requests) | Medium | Fixed |
| RI-08 | Invite code generation had a small modulo bias | Info | Fixed |
| RI-09 | Country was cut to two characters before validation, so `IRL` became `IR` | Low | Fixed |
| RI-10 | PII at rest with no retention or deletion path | Medium | Helper added; policy open |
| RI-11 | HighLevel error bodies are stored, truncated, in `ghl_error` | Info | Accepted |
| RI-12 | Anyone can register any email address with consent ticked | Medium | Open, needs double opt-in |
| RI-13 | Hand-made `.env` backups were untracked and not ignored | Low | Fixed |

### RI-01 Email enumeration

The idempotent design (a second submit returns the same invite code)
is deliberate so the thank-you state can always show the link. The
`created` field made the distinction explicit. It is removed; the form
never used it. Residual: anyone who knows an email address can still
learn that person's invite code and own referral count. Invite codes
are shared on WhatsApp by design, and the count is small and personal.
Accepted. If this becomes a concern, send the link by email instead of
returning it, which needs a sender.

### RI-02 Overwriting another person's details

`upsertRegisterInterest` refreshed name, country and phone on an
existing row with `COALESCE`. Because the form is unauthenticated, a
submit with a victim's email and a new phone number replaced the
stored phone. It did not reach HighLevel once the contact was synced,
but the local row is the source of truth. A repeat submit now changes
nothing except consent, which can only be raised.

### RI-03 Attribution hijack and self-referral

The same update set `referred_by_code = COALESCE(referred_by_code, ?)`.
Two abuses: resubmit your own email with your own code (self-referral,
plus one), or resubmit someone else's unreferred email with your code
(attribution theft). Both matter once referral counts feed a prize
draw. Attribution is now first touch only, set at creation and never
changed. Tests cover both cases.

### RI-04 Body size

`req.json()` would parse a body of any size. The route now refuses
anything over 8 KB by declared `Content-Length` and by measured length
with a 413. A real submission is under 500 bytes.

### RI-05 source_path

Client-supplied, stored as given up to 120 characters. It is never sent
to HighLevel or rendered, so the risk was only in future admin views.
It must now match a plain path (`/`, letters, digits, `/_.-`).

### RI-06 Rate limiting and client IP (open)

`clientIp()` prefers `cf-connecting-ip`, then the first
`x-forwarded-for` hop, then `x-real-ip`, then `anon`. Production only
listens on loopback behind the Cloudflare tunnel, and Cloudflare sets
`cf-connecting-ip` itself for proxied requests, so a client cannot pick
its own bucket there. Off the tunnel the header can be forged; the
test file documents this on purpose. The limit (8 per 10 minutes per
IP, invalid attempts included) is a brake on a single abuser, not on a
distributed one, and resets on restart.

Recommended before the prize draw is announced (June 2027 per the
marketing calendar):

- Cloudflare Turnstile on the hub form, verified in the route. The
  hivemind guide `turnstile-on-forms` has the pattern.
- A process-wide brake (for example 600 per 10 minutes) that returns
  429 with `Retry-After`, so a scripted flood cannot fill the table.
- Move the limiter to Redis if the web app ever runs more than one
  process (docs/22 lists this already).

### RI-07 Archive host: GET routes that write

Middleware 403s POST, PATCH, PUT and DELETE on fwc2026.tournamental.com
but a GET can write too. Two do: the signed approve and deny links for
pool join requests, which flip a membership row. Both ran unchanged on
the archive host. They now get the same 403 `archived` as a POST. The
OG bracket route also writes on GET, but only a disk cache of its own
image; left alone. The matcher regex itself only skips static
prefixes (`_next/static`, `_next/image`, `favicon.ico`, `flags/`,
`data/`, `audio/`, `assets/`), none of which hold an API route, so no
mutating path escapes middleware.

### RI-08 Invite code entropy

Seven characters from a 31-letter alphabet is about 34.7 bits. Codes
are public identifiers meant to be shared, not secrets. Guessing one
lets an attacker attribute their own signup to a stranger, which only
helps the stranger. The generator took `byte % 31`, which slightly
favoured the first eight letters; it now uses rejection sampling.
Collisions are retried five times on the unique index.

### RI-09 Country truncation

`str(body.country, 2)` cut the value before the two-letter check, so a
three-letter code passed with its first two letters: `IRL` would have
been stored as `IR`. The form prefills from `CF-IPCountry`, which is
already two letters, so only a tampered submit could hit this. Fixed
by validating the untrimmed value.

### RI-10 PII at rest (helper added, policy open)

The row holds email, first name, phone, a salted SHA-256 of the IP
(salt from `TOURNAMENTAL_INTERNAL_SECRET`, set in production; the
fallback salt is a constant, which makes the hash brute-forceable for
IPv4, so the secret must stay set), the user agent (300 characters),
and the CRM status. It lives in game.db alongside game data and in
every backup of that file. There was no way to remove a person.
`deleteRegisterInterest(tournamentId, email)` is added for privacy
requests; the HighLevel contact still has to be removed by hand.

For Tim: decide a retention period (suggest purge 12 months after the
tournament final, or on request) and say so in the privacy policy on
tournamental.com. The IP hash and user agent could be dropped after
30 days with no loss to the product.

### RI-11 HighLevel error bodies

A non-2xx response body is stored, cut to 300 characters, in
`ghl_error`. HighLevel validation errors can echo the submitted email.
That is PII already in the same row, so nothing new is exposed.
Accepted. The API key is read from the environment at call time and
never logged. Failed pushes are retried only when the person submits
again; a small background sweep of `ghl_status = 'failed'` rows would
be a reasonable addition later.

### RI-12 Unverified email and consent (open, for Tim and the lawyer)

Anyone can submit any email address with the consent box ticked.
The person then exists in HighLevel as a consenting contact. This is
the normal state of any single opt-in form, and it matters more here
for two reasons: the marketing sequences will send to these contacts,
and referral counts feed a prize draw.

Recommendation: double opt-in. The first HighLevel workflow step on
the `rwc2027_interest` tag sends a confirmation link; only confirmed
contacts get marketing messages, and only confirmed signups should
count toward referral entries in the draw. The growth plan already
assumes "verified signups"; this is what verified should mean. It
also answers the Unsolicited Electronic Messages Act 2007 consent
question cleanly. Count referrals on a canonical email (lower case,
plus-tags stripped, dots ignored for Gmail) to blunt alias farming.

### RI-13 Env backups

`apps/web/.env.production.bak-sendgrid-2026-10-15` and
`apps/auth-sms/.env.bak-sendgrid-2026-10-15` were untracked and not
matched by any ignore rule. `.gitignore` now ignores `.env.bak*` and
`.env.*.bak*` anywhere in the tree; `.env.example` is unaffected.

## Checked and found sound

- CSRF: the middleware Origin allow-list guards the route; a missing,
  foreign, look-alike or plain-http origin gets 403 `bad_origin`.
- Honeypot: the `website` field is hidden, untabbable and not
  autofilled; a filled value returns a fake success and stores
  nothing.
- Validation: email shape and length, phone normalised to E.164-style
  digits, name cut to 80, consent must be `true` or `"yes"`.
- Logging: the route logs ids and statuses only; the store never logs
  a row.
- Error responses are opaque (`store_failed`, `store_unavailable`) and
  carry `Cache-Control: no-store`.
- Response to a repeat submit is identical to a first one.

## Open for Tim

1. Turnstile and a global brake on the form before the prize draw is
   announced (RI-06).
2. Retention period and privacy policy wording for the signup data
   (RI-10).
3. Double opt-in in HighLevel before any marketing message, and
   confirmed-only referral counting for the draw (RI-12).
4. Deploy: this branch changes the archive host's behaviour and the
   signup route, so it needs the usual build and restart after merge.
