# 2026-10-17, security checklist refresh

**Task**: burn round 5, bring `docs/33-security-hardening-checklist.md` (last touched 2026-05-25) up to date against today's code.
**Branch**: `docs/security-checklist-refresh` (worktree, docs only, no build or tests).

## Plan

1. Verify every May item against `main` at e1e0eac9 and the running units on the box.
2. Mark each item done, partial or open with a file reference.
3. Add sections for the host modes (archive and hub) and the register-interest signup.
4. Record what cannot be verified from the box (Cloudflare edge rules, token scopes).

## Method

Code reads per app plus live checks: response headers on tournamental.com, play and fwc2026; the nginx config mounted into the marketing container; tunnel ingress; unit definitions; GitHub branch protection via the API; env files checked by key name only.

## Findings worth Tim's attention

- play and fwc2026 send no security headers at all; marketing gets three from nginx and no HSTS or CSP.
- `main` has no branch protection, so gitleaks and DCO are advisory.
- Turnstile exists nowhere in the repo.
- status.tournamental.com does not resolve but is promised in a public post.
- Customer 360 in admin shows full phone and email with no audit of the view.
- Cloudflare OTP rules and token scopes could not be verified from the box.

## Outcome

Checklist rewritten in place (216 lines), two new sections (H host modes, I register-interest), threat table refreshed. Draft PR opened; nothing merged or deployed.
