# 2026-05-13 — Legal pages: Terms, Privacy, Cookies

Task: parallel agent task — pre-launch legal docs so the platform can lawfully
collect phone numbers and emails for OTP login.

Status: in-progress.

## Scope

Three new pages under `apps/marketing/src/pages/legal/`:

- `terms.astro` — Terms of Service (~3000 words)
- `privacy.astro` — Privacy Policy (~3000 words)
- `cookies.astro` — Cookie Notice + preference centre (~1200 words)

Plus:

- Footer linkage to the three legal routes + brand "© 2026 Tournamental
  Holdings · Apache 2.0 code · CC-BY docs" line, restructured to three
  columns per brief (Brand / Build / Legal).
- Consent line above the OTP send button on `login.astro` (Telegram +
  phone sections) + the bracket-app email OTP flow link.
- `/legal` index (existing flat page) becomes a hub linking out to the
  three sub-pages.

## Out of scope (parallel agents)

- `apps/auth-sms/` and `apps/identity/` — owned by the OTP brute-force
  agent (task #96). Not touched.
- `CODE_OF_CONDUCT.md`, `FUNDING.yml`, `README.md` — owned by the
  OSS-readiness agent (task #94). Not touched.

## Legal flags

The brief is explicit that these are "good first drafts" and need a NZ-
licensed lawyer's review. Flagged in each doc:

- NZBN: placeholder, TODO when company registration confirmed.
- Wellington venue clause: placeholder.
- `privacy@tournamental.com` + `legal@tournamental.com` — TODO to wire
  the mailbox before launch.
- `/profile/data-export` page is a stub — flag for the identity agent.
- Cookie preference form submits to a stub endpoint
  `/api/cookie-prefs` — flag for the analytics agent to wire the store.

## Acceptance

- `pnpm --filter @vtorn/marketing build` green.
- All three pages render on a 360px viewport without horizontal scroll.
- Footer Terms / Privacy / Cookies links resolve to the new routes.
- Conventional commit, signed-off, email `0800tim@gmail.com`.

Refs: prompts/legal-pages-pre-launch.md (in-brief, no doc in /docs/ yet).
