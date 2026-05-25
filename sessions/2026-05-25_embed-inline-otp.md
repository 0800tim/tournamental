# Session: embed inline OTP sign-in

status: done
date: 2026-05-25

## Task
The embedded widget (private pool "the-crate" on partner sites) could not
authenticate: the popup -> postMessage flow relies on third-party cookies
(blocked in incognito / Safari ITP / Firefox ETP) and `/join` was
cookie-only, so a signed-in embed user still got 401 on request-access.

## What changed
- **New** `apps/web/app/api/v1/auth/widget-otp/route.ts` (CORS-open):
  `action:"request"` + `action:"verify"` proxy to auth-sms and mint a
  widget bearer token (`iss=tournamental-widget, scope=widget`) on a
  correct code. No session cookie crosses origins.
- `apps/web/app/embed/widget.js/route.ts`: inline OTP form (email/phone
  toggle, code entry, resend, friendly errors); shown by default on a
  private pool; non-mutating status GET on load + reload; one-tap
  request-access for an authed-but-not-member viewer.
- `apps/web/app/api/v1/syndicates/[slug]/join/route.ts`: bearer-aware
  session resolution, CORS-open (GET/POST/DELETE/OPTIONS), derived
  fallback handle, `status` on GET, owner/active short-circuit.
- `apps/web/lib/syndicate/persistence.ts`: `getMembershipStatus()`;
  `isMember()` treats legacy NULL status as active.

## Verified
Minted tokens + real browser embed (partner origin -> widget): request ->
code -> verify -> bearer token (stored first-party) -> request access ->
pending, persisted across reload, owner not re-notified. Owner/active
members render the bracket. Cleaned up all test users / HighLevel contacts.

## Next steps
None for this feature. The legacy popup path still works as a fallback.
