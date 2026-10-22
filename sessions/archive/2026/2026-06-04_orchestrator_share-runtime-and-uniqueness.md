---
date: 2026-06-04
agent: orchestrator
status: completed
pr: 263
branch: fix/share-page-runtime-error-and-handle-uniqueness
---

# /s/<handle> runtime + display-name + email uniqueness

## What Tim hit

1. **Runtime error on /s/0800tim and /s/jonas.**
   `TypeError: Cannot read properties of undefined (reading 'call')`
   at `webpack.js:715:31`. PR #262's defensive try/catch in
   `ReadOnlyBracket` didn't actually stop it, error fires at chunk
   load time, not in component logic.

2. **Pretty URLs vs permalinks.** PR #262 routed pool tiles to
   `/s/u_<hex>`. Tim wants the display-name slug back: `/s/jonas`.
   "Renames may break old links, but bookmarking shares is rare and
   it's the slug that people tweet."

3. **Display-name hijack.** Tim set his display_name to "jonas"
   which already belonged to another user. The handle resolver picks
   "most recently active wins", so this silently took over the
   other user's `/s/jonas`.

4. **(Follow-up from Tim)** "What about email/phone collisions?
   Could I hijack another account that way?"

## What shipped (PR #263)

### Runtime error fix

Wrapped `ReadOnlyBracket` in `next/dynamic({ ssr: false })` in
`apps/web/app/s/[guid]/page.tsx`. The component now loads in its
own client chunk after hydration, isolating it from the page-level
chunk-split issue. Import aliased to `nextDynamic` to avoid
colliding with the route-level `export const dynamic = "force-dynamic"`.

This is a workaround rather than a root-cause fix, but the symptom
matches a webpack chunk-split bug not a component bug, ShareMolecule
uses identical imports and works fine. If we want to root-cause it
later, the lead is: what changed in the page-level client manifest
when we added `BracketPosterCallout` + `ReadOnlyBracket` to /s/[guid]
in the same window.

### Pool tile URL priority

Slug first, permalink only as fallback for anonymous pool members:

```ts
const slug =
  slugifyDisplayName(m.display_name) ??
  slugifyDisplayName(m.handle) ??
  null;
const isPermalinkUser = !!m.user_id && /^u_[0-9a-f]+$/i.test(m.user_id);
const profileHref = slug
  ? `/s/${slug}`
  : isPermalinkUser
    ? `/s/${m.user_id}`
    : null;
```

### Uniqueness in PATCH /v1/auth/me

Two pre-checks before the UPDATE in `apps/auth-sms/src/routes/session.ts`:

- **display-name**: slugify the proposed value with the same rule as
  `apps/web/lib/share/handle-slug.ts`; if any other user resolves to
  that handle, return 409 `display-name-taken`.
- **email**: lower-case the proposed value (we already do); if any
  other user is on that email, return 409 `email-taken`.

The DB UNIQUE constraint on `user.email` stays as the race-condition
backstop. Added `Storage.getUserByEmail()` for the explicit pre-check.

ProfilePage humanises the new code:
"Someone else already uses that display name. Pick a different one."

### Why phone is structurally safe

`/v1/auth/me` PATCH's `stringField` allowlist doesn't include `phone`.
The only paths that write `user.phone` are the verified-OTP signup
flows (verify-otp.ts, verify-by-code.ts, magic-verify.ts). All require
possession of the device. So phone hijack via profile edit is
impossible by construction, no code change needed today.

## Follow-ups (separate PR)

### "Link phone" button for email-OTP signups

Tim's design: an email-OTP-signed-up user clicks **"Add phone number"**.
The UI shows them a WhatsApp QR/link to our number, asks them to send
any message. The inbound webhook receives the message, replies with a
6-digit code via WhatsApp, the UI prompts for the code, we verify and
attach `user.phone` to the signed-in session.

Surface area:
- `apps/web/components/auth/ProfilePage.tsx`: new "Add phone number"
  button, modal with WhatsApp deep-link + OTP entry field.
- `apps/auth-sms/src/routes/`: new endpoint to mint a one-shot
  pairing challenge keyed to the authed userId. Inbound webhook
  (`inbound-login.ts` or a sibling) detects the pairing challenge,
  sends OTP via WhatsApp, on verify links `user.phone` to the
  pairing's userId.
- Replaces the existing inert "contact support to change it" hint on
  the phone field.

Tracked as task #43.

### Pre-existing em-dash in ProfilePage

`apps/web/components/auth/ProfilePage.tsx` line 215 has the literal
em-dash character as the fallback for the phone display string. Not
in this diff but should be swept in a future cleanup pass per the
`feedback_no_emdashes` user rule.

## Verification on dev

After merge, test on dev:

- [ ] /s/0800tim loads without the webpack runtime error
- [ ] /s/jonas loads (resolves to whichever user owns "jonas" slug)
- [ ] Pool tile clicks go to /s/<displaynameslug> form
- [ ] Setting display_name to one another user already uses returns
      "Someone else already uses that display name"
- [ ] Setting email to one another user already uses returns
      "That email is already linked to another account"

## Not deployed to prod

Per Tim's standing rule (`feedback_dev_first_then_prod`), wait for
sign-off before `pnpm --filter @vtorn/cicd-tools run publish-all
-- --env=production --apps=web`.
