# 33, Security hardening checklist

> Pre-launch security pass for Tournamental. We're a free-to-play prediction game with affiliate links and (eventually) authenticated users, the threat model is mostly: bot floods on the bracket, scraping of our odds-cache, abuse of affiliate-click endpoints, and PII leakage on phone-OTP flow. Plus the standard OWASP top-10 across every public surface.
>
> Run this checklist before each public launch. Date last reviewed: 2026-05-10.

## A. Public surfaces

### `apps/marketing` (Astro static)
- [ ] CSP header restricts script sources to self + GA4 + Meta Pixel + Cloudflare
- [ ] No inline `<script>` (Astro generates SSG so this should be free)
- [ ] HSTS (`max-age=31536000; includeSubDomains; preload`)
- [ ] X-Content-Type-Options: nosniff
- [ ] Referrer-Policy: strict-origin-when-cross-origin
- [ ] Permissions-Policy denies camera, mic, geolocation, payment unless explicitly needed
- [ ] Cloudflare Turnstile on syndicate-pre-signup form (anti-bot)

### `apps/web` (Next 14, multi-host)
- [ ] Same security headers via `middleware.ts` (already deployed for the WC redirect, extend with security headers)
- [ ] CSP narrowed: scripts from self, blob: (for Three.js workers), no `unsafe-eval` in prod
- [ ] Subresource Integrity (SRI) on any third-party CDN scripts
- [ ] Frame-ancestors 'none' to prevent clickjacking
- [ ] CORS narrowed (don't allow `*` for credentialed routes)
- [ ] Cloudflare Turnstile on `/api/syndicate/intent` and `/api/affiliate/click`
- [ ] Rate limit at Cloudflare edge: 60 req/min/IP for `/api/*`, 5 req/min/IP for write endpoints

### `apps/api` (Fastify)
- [ ] Helmet plugin (or fastify-helmet) wired into all routes
- [ ] All endpoints have explicit schema validation (Fastify schema or Zod)
- [ ] Rate limit per endpoint via `@fastify/rate-limit`
- [ ] All DB queries are parameterised (no string concat)
- [ ] All write endpoints require auth (JWT in HTTP-only cookie)
- [ ] CORS allow-list (no `*`), credentials only from our own hosts

### `apps/admin` (Next 14)
- [ ] Magic-link only; no password auth
- [ ] `ADMIN_EMAILS` env var allowlist; default deny
- [ ] JWT in HTTP-only Secure cookie, SameSite=Strict, 8h expiry
- [ ] Audit log for every write action (user_id, ip, ua, action, target, ts)
- [ ] No GET requests cause side effects
- [ ] Sensitive PII (phone numbers) redacted in views unless an explicit "show" action (which is itself audited)

### `apps/odds-ingest` (Fastify)
- [ ] No write endpoints (read-only)
- [ ] Rate limit 60 req/min/IP
- [ ] CORS: allow only our own hosts + Polymarket affiliate domain
- [ ] No upstream API keys leaked in error responses

### `apps/auth-sms` (Fastify)
- [x] OTP rate-limit on send: 1/60s per phone, 5/hour per phone, 30/hour per IP (see `apps/auth-sms/src/rate-limit.ts`)
- [x] OTP rate-limit on verify: 5 attempts/code, 5 failed verifies in 15 min triggers 1-hour phone lockout, 30 verifies/5 min/IP (see `apps/auth-sms/src/lockout.ts` and the brute-force section below)
- [x] Constant-time OTP verify with decoy HMAC on unknown phone (no timing leak about existence)
- [x] OTP secrets are HMAC-SHA256 hashes; never plaintext at rest
- [x] OTP TTL ≤ 10 min, single-use (deleted on success or after attempts exhausted)
- [x] JSONL audit log of every send + verify outcome at `data/audit/otp.log.jsonl` (path configurable via `AUDIT_LOG_PATH`) , never contains plaintext phone, only its truncated SHA-256 (`phoneId`)
- [ ] Phone number storage encrypted at rest (sqlcipher or app-layer AES with `PHONE_ENCRYPTION_KEY` env)
- [ ] WebOTP API binding optional, never required
- [ ] Baileys auth state outside the repo, gitignored, in `baileys-auth/` with 0700 perms
- [ ] No SMS gateway URL or token in client bundles
- [ ] CORS strict (only our auth page can call /v1/auth/*)

### `apps/dm-otp` (Fastify)
- [x] Per-record 5-attempt cap and 5-minute TTL (existing `CodeStore`)
- [x] Per-subject lockout: 5 failed verifies for the same (channel, externalId) in 15 min locks the subject for 1 hour, even across fresh OTPs (see `apps/dm-otp/src/lib/brute-force.ts`)
- [x] Per-IP throttle: 30 verifies/5 min/IP across all subjects, returns 429 with Retry-After
- [x] Magic-link click route shares the IP throttle (token-only lookup)
- [ ] Migrate brute-force state to Redis once dm-otp is horizontally scaled (currently in-memory; documented TODO at the top of `brute-force.ts`)

## OTP brute-force protection (defence in depth)

Two layers, applied independently. Either alone is sufficient against an
unmotivated attacker; together they make a serious attacker pay heavy
infrastructure costs before extracting one account.

### Threat model

| Threat | Mitigation |
| --- | --- |
| Online code guessing (1M code space) | App layer caps individual-code attempts at 5; phone lockout 5 failed verifies / 15 min -> 1h block; per-IP 30/5min throttle catches cycling phones. |
| Phone-number enumeration via timing | Constant-time HMAC compare runs even when phone is unknown (`apps/auth-sms/src/routes/verify-otp.ts` decoy). |
| SIM-swap then replay | OTP is single-use and TTL'd at 10 minutes; sessions tied to a specific phone, and the user can revoke from `/v1/auth/session/logout`. SIM-swap of a high-value account remains out of v0.1 scope per docs/32. |
| Distributed brute force from many IPs | Cloudflare edge rate-limit rules (`infra/cloudflare/otp-protection.sh`): 10 req/min/IP on send (managed_challenge), 15 req/min/IP on verify (block 10m), 30 req/min/IP aggregate across `/v1/auth/otp/*` (block 1h). |
| Botnet from suspicious ASN | WAF custom rule managed-challenges `/v1/auth/otp/*` from a curated ASN list (Twilio, mass-VPS providers). Tunable; the script enforces idempotency by stable rule description. |
| Headless-browser scripted abuse | Bot Fight Mode at the zone level (managed_challenge on cloudflare-detected bots). |

### App-layer thresholds (codified in `apps/auth-sms/src/lockout.ts`)

| Layer | Window | Threshold | Action |
| --- | --- | --- | --- |
| Per-OTP attempts | until expiry | 5 | OTP deleted, 429 too-many-attempts |
| Per-phone failures | 15 min | 5 | phone locked 1 hour, 429 phone-locked |
| Per-IP verifies | 5 min | 30 | 429 ip-throttled |

A successful verify clears the per-phone failure counter and the lockout
sentinel, so a returning user who fat-fingered their code once is not
penalised.

### Cloudflare-layer thresholds

Apply via `bash infra/cloudflare/otp-protection.sh` (idempotent, every
rule keyed by stable description). Dry-run first: `--dry-run`.

| Rule | Path | Threshold | Action |
| --- | --- | --- | --- |
| `tournamental-otp-send-rate-limit` | `/v1/auth/otp/send` | 10 req/min/IP | managed_challenge |
| `tournamental-otp-verify-rate-limit` | `/v1/auth/otp/verify` | 15 req/min/IP | block 10m |
| `tournamental-otp-aggregate-rate-limit` | `/v1/auth/otp/*` | 30 req/min/IP | block 1h |
| `tournamental-otp-asn-managed-challenge` | `/v1/auth/otp/*` from listed ASNs | any | managed_challenge |
| `tournamental-otp-bot-fight-mode` | zone-level | n/a | Bot Fight Mode on |

Rollback: `bash infra/cloudflare/otp-protection-revert.sh`. The revert
script strips every rule whose `description` matches one of the five
above and turns Bot Fight Mode back off.

### Recovery for legitimate users

If a real user trips the phone lockout (5 wrong codes in 15 min), they
see a 429 with `error: "phone-locked"` and `retryAfterSeconds`. The
auth page shows "Try again in N minutes, or email
support@tournamental.com if you cannot wait." Support can run

```sql
DELETE FROM rate_limit WHERE key LIKE 'verify:phone:+6421...:%';
```

to clear the lockout for one phone. The audit log
(`data/audit/otp.log.jsonl`) records every lockout event for forensics.

### `apps/tournament-bot` (grammy)
- [ ] Webhook secret token (Telegram `secret_token`) verified on every update
- [ ] Push frequency caps enforced server-side
- [ ] Affiliate CTA push gated on `cf-ipcountry` AND user-opt-in
- [ ] Bot token never logged; redacted in error reports

## B. Secrets

- [ ] `.env` is gitignored everywhere (already true)
- [ ] `.env.example` documents every required key without values
- [ ] No secrets in source (gitleaks runs on every PR; verify it's enforced as a CI gate, not just an info check)
- [ ] Cloudflare API token has minimal scope (Tunnel:Edit, DNS:Edit on our zones only, already true post-rotation)
- [ ] Polymarket affiliate ref URL is fine in client (it's our public ref)
- [ ] ElevenLabs key server-side only (never sent to client)
- [ ] OpenAI / Anthropic keys: server-side only
- [ ] BotFather token: server-side only
- [ ] SQLCipher encryption keys: derived from `MASTER_KEY` env, rotated on a documented schedule

## C. Data + privacy

- [ ] Phone numbers, IPs, emails treated as PII per NZ Privacy Act 2020 + GDPR
- [ ] Privacy policy live at `https://tournamental.com/legal/privacy` (audit before launch)
- [ ] Data subject access request (DSAR) flow documented in `docs/19` or new doc
- [ ] Right-to-be-forgotten flow: delete user → cascade to all bracket / pick / event / push / affiliate-click rows tagged with that user_id
- [ ] PII minimisation: don't ask for what we don't need (no DOB, no real name unless syndicate explicitly requires)
- [ ] All GA4/Meta Pixel events have anonymised user identifiers (hashed, never plaintext phone/email)
- [ ] EU users get explicit cookie banner with reject-all option
- [ ] NZ users see no Polymarket affiliate CTA (compliance gate already in `docs/30`)

## D. Bot abuse

- [ ] Cloudflare Turnstile on every public write surface
- [ ] Bracket edit limit 200/pick/tournament (server-side recompute)
- [ ] Same-IP detection on suspiciously high lock multipliers
- [ ] Affiliate click throttling: 3 events / market / user / 24h
- [ ] Quiz-answer dedupe (one per drop)
- [ ] WebSocket per-IP connection cap (10/IP for the producer stream)
- [ ] Account-creation rate limit (1/IP/min on /v1/auth/request)

## E. Smart-contract (deferred until VStamp ships)

Per `docs/21-onchain-sweepstakes-oracle.md`:
- [ ] Testnet deployment first, mainnet only after external audit
- [ ] Reentrancy guards on every state mutation
- [ ] Withdrawal pull-pattern (no push transfers)
- [ ] Time-locked oracle inputs
- [ ] Multi-sig for treasury (minimum 2/3 with Growth Spurt Ltd + Tim + auditor)
- [ ] Documented incident-response runbook

## F. Build pipeline

- [ ] `pnpm audit` zero high-severity vulns (as of 2026-05-10)
- [ ] Dependabot grouped weekly minor/patch (already configured)
- [ ] gitleaks gating CI (already enforced)
- [ ] DCO sign-off enforced on every commit (already enforced)
- [ ] Lockfile checked in and not regenerated on every PR
- [ ] No `--no-verify` skips on commits
- [ ] CI runs as least-privileged GH Actions principal

## G. Incident response

- [ ] On-call rotation (single-person Tim during launch)
- [ ] Status page at `https://status.tournamental.com` (Cachet or BetterUptime)
- [ ] PagerDuty / Opsgenie hookup (or just Telegram bot ping to Tim's chat)
- [ ] Runbooks for: prod outage, data breach, affiliate-revenue dispute, Polymarket downtime, Cloudflare outage

## Threat model summary

| Threat | Probability | Impact | Mitigation |
| --- | --- | --- | --- |
| Bot signup flood pre-launch | High | Medium | Turnstile + per-IP rate limit |
| Affiliate-click fraud | Medium | High (revenue) | Server-side throttle + dedup + Polymarket-side validation |
| Bracket data scraping | High | Low | It's public anyway; only protect /v1/admin/* |
| Phone OTP brute force | Low | Medium (account takeover) | Rate limit + 5-attempt lock + TTL |
| WhatsApp Baileys session hijack | Low | High (impersonation) | 0700 perms on auth dir, cycle pairing every 30 days |
| Polymarket affiliate program closure | Low | Critical (revenue) | Multi-source provider abstraction (`docs/30` § Risks) |
| NZ DIA enforcement | Low | Critical (legal) | Geo-gate already enforced; no offshore-sportsbook links to NZ users |
| Cloudflare worker outage | Low | High | Multi-tunnel fallback (maintain a secondary dev tunnel as static cutover) |
| Renderer code injection via face_uri | Low | Medium | Wikidata/Wikimedia content trusted; sanitised; no eval |

## Sign-off

- [ ] Tim reviews this checklist before each launch
- [ ] Reviewer agent posts the diff against the previous run as a PR comment
- [ ] Failed items → tickets in `tasks/in-progress/` with owner + ETA
