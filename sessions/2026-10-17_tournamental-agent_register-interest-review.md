---
status: done
agent: tournamental-agent
date: 2026-10-17
task: Security review of the RWC 2027 register-interest flow (burn board, round 4)
refs: docs/reviews/2026-10-register-interest.md
---

# Register-interest security review

## Plan

Read route, store, HighLevel client, rate limiter and the archive
branch of the middleware. Fix in code what can be fixed, write tests
with HighLevel mocked, write up findings and open questions. Separate
worktree; production runs from the main checkout.

## Done

- Review at docs/reviews/2026-10-register-interest.md: 13 findings,
  9 fixed here, 4 open for Tim (Turnstile, retention, double opt-in,
  deploy).
- Fixes: repeat submits no longer overwrite PII or attribution
  (self-referral and attribution theft closed), `created` flag
  removed from the response, 8 KB body cap, `source_path` validated,
  country validated before trimming, unbiased invite codes,
  `deleteRegisterInterest` helper, archive host 403s the approve and
  deny GET links, `.env.bak*` ignored.
- 66 tests in apps/web/__tests__/register-interest/ (route, store,
  HighLevel client, rate limiter, archive API guard). No network.

## Verification

- `vitest run __tests__/register-interest`: 66 passed.
- `eslint` on the changed files: clean.
- Not run: full suite (157 pre-existing failures on main, logged
  17 Oct) and `tsc --noEmit` (too slow on this app).

## Not deployed

Needs merge, build and restart by Tim.
