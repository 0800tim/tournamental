# 2026-05-12 , OTP brute-force protection (app + Cloudflare WAF)

- **Agent**: security-hardening
- **Branch**: `feat/otp-brute-force-protection`
- **Status**: shipped (PR #177)
- **Docs**: 32-auth-and-privacy.md, 33-security-hardening-checklist.md, 22-deployment-and-tunnels.md

## Plan

Two-layer defence:

1. **App layer** , harden existing auth-sms and dm-otp rate-limit + lockout:
   - Add per-IP verify rate limit (30 / 5 min) to catch attackers cycling phone numbers across the IP.
   - Add a phone/identity lockout that lasts 1 hour after 5 failed verifies.
   - Add JSONL audit log at `data/audit/otp.log.jsonl` (or whichever path the operator points `AUDIT_LOG_PATH` at).
   - Add a constant-time decoy HMAC compute when phone is unknown so verify timing does not leak existence.
   - Reuse the existing `rate_limit` SQLite table; reuse the existing CodeStore TTL in dm-otp.
2. **Cloudflare layer** , idempotent `infra/cloudflare/otp-protection.sh` that applies WAF custom rules + rate-limit rulesets against the tournamental.com zone. Sibling `otp-protection-revert.sh` to roll back.

State lives in SQLite for auth-sms (existing better-sqlite3 store, since the service is single-instance and there is no Redis there yet). dm-otp keeps its in-memory store and gets the per-IP + lockout layered in front in-process; a TODO marks the Redis migration when the service goes horizontal.

## Acceptance

- `pnpm --filter @vtorn/auth-sms test` green.
- `pnpm --filter @vtorn/dm-otp test` green.
- `bash infra/cloudflare/otp-protection.sh --dry-run` prints every API call it would make and exits 0.
- Docs 22, 32, 33 updated with the new thresholds + rollback runbook.

## Open questions

None blocking. Tim may want to tune the IP cap (currently 30 verify / 5 min) once we see real traffic.

## Outcomes

- App-level limits implemented in `apps/auth-sms/src/rate-limit.ts` + new
  `apps/auth-sms/src/lockout.ts` and `apps/auth-sms/src/audit.ts`; verify
  route now consults both before any HMAC compare and writes an audit
  line on every send + verify outcome.
- Constant-time decoy hash now runs on verify when phone is unknown.
- dm-otp got an in-memory `IpVerifyLimiter` + `ChannelLockout` layered
  into the verify route so attackers can't fan out across externalIds.
- Cloudflare scripts at `infra/cloudflare/otp-protection.sh` (apply) and
  `otp-protection-revert.sh` (rollback); dry-run prints every PUT and
  exits clean.
- Tests added: `apps/auth-sms/test/otp-brute-force.test.ts`,
  `apps/dm-otp/test/brute-force.test.ts`, and a bash-level
  `infra/cloudflare/test/otp-protection-dryrun.test.sh`.

## Next steps

- Redis-backed lockout state once dm-otp goes horizontal.
- WAF ASN allowlist tuned with real abuse data post-launch.
- Tim to review the rate thresholds.
</content>
</invoke>