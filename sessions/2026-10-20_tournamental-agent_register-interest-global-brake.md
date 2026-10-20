# 2026-10-20, register-interest global brake (RI-06)

**Task**: burn round 7, add a per-process ceiling on register-interest submissions per minute on top of the per-IP limit.
**Branch**: `fix/register-interest-global-brake`, stacked on `review/register-interest-security` (draft PR #336), worktree.

## What changed

- `apps/web/lib/register-interest/brake.ts`: `checkGlobalBrake()` keyed on one bucket for the whole process, ceiling from `REGISTER_INTEREST_GLOBAL_PER_MINUTE` (positive integer, anything else means 60), 60 s window, operator warning at most once a minute while engaged.
- `app/api/v1/register-interest/route.ts`: after the per-IP check and before the body is read, a refused attempt answers 429 `{ ok: false, error: "rate_limited", scope: "global" }` with `Retry-After` and `no-store`. The per-IP limit of 8 per 10 minutes is unchanged.
- `lib/rate-limit/in-memory.ts`: `resetRateLimitBuckets(prefix?)` for tests.
- `.env.example`: the variable documented, no secret.
- `docs/reviews/2026-10-register-interest.md`: RI-06 row updated; Turnstile stays open.

## Tests

`__tests__/register-interest/brake.test.ts` (env parsing, ceiling, Retry-After, warn throttle, default on nonsense) and three cases in `route.test.ts` (cap across different IPs, invalid attempts count, per-IP refusal takes precedence). The register-interest folder: 74 pass under `systemd-run --user --scope -p MemoryMax=3G`. eslint and tsc clean.

## Needs Tim

Merge after #336 (this branch contains it); set `REGISTER_INTEREST_GLOBAL_PER_MINUTE` in `apps/web/.env.production` only if 60 a minute is the wrong number for launch week. Turnstile on the form is a third-party integration and stays Tim's call.
