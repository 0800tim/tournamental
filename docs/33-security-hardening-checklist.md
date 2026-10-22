# 33, Security hardening checklist

> Pre-launch security pass for Tournamental. Free-to-play prediction game with affiliate links and phone-OTP auth. The threat model is mostly: bot floods on the bracket and on the register-interest form, scraping of the odds cache, abuse of affiliate-click endpoints, and PII leakage on the OTP and signup flows. Plus the standard OWASP top 10 across every public surface.
>
> Run this checklist before each public launch. Date last reviewed: 2026-10-21 (against `main` at 76e4db87, after the October review round #335 to #365 merged and deployed on 2026-10-20; the 2026-10-17 pass was against e1e0eac9).

## How to read this review

Every item carries one of three states and a file reference so the next reviewer can re-check it in minutes.

- `[x] Done`: verified in code, and on the live box where the item is about production.
- `[ ] Partial`: some of the control exists; the gap is spelled out.
- `[ ] Open`: nothing in the repo does this yet.

What is actually in production today (user units on the box, all behind the Cloudflare tunnel in `~/.cloudflared/config-tournamental.yml`): `apps/web` (:3300, serves play, the hub and the fwc2026 archive), `apps/game` (:3360), `apps/auth-sms` (:3330), `apps/admin` (:3340), `apps/odds-ingest` (:3341), `apps/tournament-bot` (:3350, polling), and the marketing site as an nginx container (`tournamental-web`, 127.0.0.1:9260) serving `apps/marketing/dist`. Not deployed: `apps/api` (api.tournamental.com answers 530, no ingress), `apps/affiliate-router`, `apps/stream-server`, `apps/dm-otp`, `apps/security-watchdog`. Items for undeployed services are verified against code only.

Two things changed the shape of the attack surface since the May review and get their own sections at the end: the **host modes** (live, hub, archive) added on 2026-10-16, and the **register-interest** signup on the hub.

## A. Public surfaces

### `apps/marketing` (Astro static, nginx on the box)

Headers come from the nginx config at `/data/infra/apps/tournamental/nginx.conf` (outside the repo, mounted into the container). `apps/marketing/public/_headers` is a Cloudflare Pages manifest and nginx does not read it; it only carries cache rules for the API docs bundle.

- [ ] Open: CSP header restricting scripts to self + GTM/GA4 + Cloudflare. No `Content-Security-Policy` is sent (checked live on tournamental.com 2026-10-17). `apps/marketing/src/components/Analytics.astro` injects an inline gtag bootstrap, so a CSP needs a nonce or a hash for that block.
- [ ] Partial: no inline `<script>`. Astro inlines small scripts in `src/layouts/Layout.astro`, `src/components/Header.astro`, `src/pages/legal/cookies.astro` and a few pages. Fine without a CSP; becomes work once one lands.
- [ ] Open: HSTS. Not sent by nginx or by the edge (no `strict-transport-security` on the live response). Turn on at the Cloudflare zone (SSL/TLS, Edge Certificates) rather than in nginx so it covers every hostname.
- [x] Done: `X-Content-Type-Options: nosniff` (nginx `add_header`, verified live).
- [x] Done: `Referrer-Policy: strict-origin-when-cross-origin` (nginx, verified live).
- [ ] Open: `Permissions-Policy`. Not set anywhere. `X-Frame-Options: SAMEORIGIN` is set, which covers clickjacking for the marketing site.
- [ ] Open: Cloudflare Turnstile on the syndicate pre-signup form. No Turnstile anywhere in the repo (`grep -ri turnstile apps packages` finds only this document). The pre-signup route `apps/web/app/api/syndicate/intent/route.ts` writes JSON files to disk with validation but no rate limit and no honeypot. It is unreachable in hub and archive mode (see host modes) and reopens when a tournament goes live.

### `apps/web` (Next 14, three host modes)

- [x] Done: security headers. `apps/web/lib/security/headers.mjs` via `next.config.mjs` `headers()` (PR #345, live 2026-10-20): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY` and `frame-ancestors 'none'` on play.tournamental.com, verified on the live response after the deploy.
- [ ] Partial: CSP. `Content-Security-Policy-Report-Only` is sent (PR #345) with `blob:` workers, the GTM bootstrap, and the Telegram login widget's origins (`telegram.org` script, `oauth.telegram.org` frame, review 345-2). There is no report endpoint, so promotion to enforcing is a manual watch of the browser console on the hub, the archive and, before the next live day, the live mode. Tim's call to promote.
- [x] Done: SRI on third-party CDN scripts. There are none; the only third-party script is GTM, loaded from `googletagmanager.com` by `GtmRoot.tsx`, which cannot be SRI-pinned. Nothing from a generic CDN.
- [x] Done: `frame-ancestors 'none'` and `X-Frame-Options: DENY` per route (PR #345): exempt for `?embed=1`, `/embed/*` and the archive hosts (`ARCHIVE_HOSTS`), which partner pages frame; verified live on 2026-10-20 (no framing headers on `?embed=1` or fwc2026.tournamental.com). Open item for live mode: in-frame links need `target="_top"` or to carry `?embed=1` before the rule is enforced on play (review 345-1, needs Tim).
- [x] Done: CORS narrowed. `app/api/v1/auth-status/route.ts` echoes `Origin` with credentials (documented as safe: it exposes nothing the embedding page cannot already see). `app/api/v1/syndicates/[slug]/join/route.ts` sends no `Allow-Credentials` and only echoes a known origin. The widget script itself is `*` but carries no credentials.
- [x] Done: CSRF guard on every mutating `/api/v1/**` call (SEC-WEB-01, `middleware.ts` `CSRF_ALLOWED_ORIGINS`). Needed because `tnm_session` is `SameSite=None; Secure` (`apps/auth-sms/src/routes/magic-verify.ts` `buildSessionCookie`). Bearer-token widget routes are exempt. PR #335 adds 83 tests covering this ordering.
- [ ] Partial: GET routes that write. `join-requests/[userId]/approve` and `deny` are GET handlers (signed links for owners). PR #336 blocks them on archive hosts (`ARCHIVE_BLOCKED_API`). They remain GET on the live host because they are opened from email; acceptable while signed and single-purpose.
- [ ] Open: Turnstile on `/api/syndicate/intent`, `/api/affiliate/click` and the register-interest form. See section D.
- [ ] Partial: rate limits. In-process limiter `lib/rate-limit/in-memory.ts` guards `register-interest` (8/10 min/IP) plus a global brake across all addresses (`REGISTER_INTEREST_GLOBAL_PER_MINUTE`, default 60, PR #354), `widget-otp`, `manage-auth` and `handle-check`. No general `/api/*` limit in the app and no Cloudflare rate rule for `play.*` that this review could verify from the box (`infra/cloudflare/otp-protection.sh` only covers `/v1/auth/otp/*` on auth.tournamental.com). Edge rules need the dashboard or an API token to confirm.

### `apps/api` (Fastify, not deployed)

- [x] Done: `@fastify/helmet` registered in `src/server.ts` (CSP off, documented as edge-handled).
- [ ] Partial: schema validation. `routes/health.ts` and `routes/version.ts` carry schemas; `routes/admin.ts` is a `0.1.0-stub` with the JWT verifier written as pseudocode in a comment. Nothing to validate until the admin routes are real.
- [x] Done: `@fastify/rate-limit` 1000/min global with loopback allow-list.
- [x] Done: no string-built SQL (`src/` has no query concatenation; the service has no DB layer yet).
- [ ] Open: write endpoints require auth. There are no write endpoints yet, and the admin bearer verifier is not wired. Treat as open until `apps/api` ships.
- [x] Done: CORS allow-list from `VTORN_API_CORS_ORIGINS`, default play + localhost, credentials only for listed origins.

### `apps/admin` (Next 14)

The May items assumed magic-link email sign-in. The gate moved to WhatsApp OTP step-up behind Cloudflare Access (`lib/auth.ts` header comment, `lib/perms.ts` note). Items re-read against that.

- [x] Done: no password auth. Sign-in is a server-held admin phone + OTP via auth-sms `verify-by-code`; the browser never chooses the phone.
- [x] Done: allow-list, default deny. `ADMIN_ALLOWED_USER_IDS` checked in `app/api/auth/verify/route.ts`; `ADMIN_EMAILS` and the role map were removed with the magic-link flow. Every authed admin is super-admin for now; the RBAC matrix in `lib/perms.ts` is kept for later.
- [ ] Partial: session cookie. `__Host-admin` is HttpOnly, Secure in production, `SameSite=Lax`, Path=/ (`app/api/auth/verify/route.ts`). TTL is 24 h, not the 8 h this checklist asked for; the reason is documented in `lib/auth.ts`. Middleware crypto-verifies the JWT for `/api/**` and checks presence for UI routes, with `requireAuth()` doing the full check server-side.
- [ ] Partial: audit log. `lib/audit.ts` appends every state-changing action to `.admin-audit.jsonl` (user, action, target, timestamp). IP and user agent are not recorded. The planned move to a Postgres row via `apps/api` has not happened.
- [x] Done: no GET side effects. No GET handler under `apps/admin/app/api` writes.
- [x] Done: PII redaction. The settings and syndicate pages mask phones (`maskAdminPhone`, `maskPhone`); the Customer 360 tab masks phone and email by default with an audited reveal (PR #352, `lib/pii.ts`, reveal routes write to the audit log). Still unmasked, by design and for Tim to confirm: the users list column (a search key) and the user page header (review item 24).

### `apps/odds-ingest` (Fastify)

- [x] Done: read-only. `src/api.ts` registers GET routes only.
- [ ] Open: rate limit. No `@fastify/rate-limit`; the service relies on the edge. Reads are cached aggregates, so the risk is cost, not data.
- [ ] Partial: CORS is `origin: true` (any origin) by design, documented in `src/api.ts` as public anonymised data. The May wording (own hosts + Polymarket) no longer matches intent; accept or narrow, but decide.
- [x] Done: no upstream key in responses. `THE_ODDS_API_KEY` only appears in the upstream URL built in `src/sources/the-odds-api.ts`, used by the background poller, and `src/index.ts` logs it as `<set>`.

### `apps/auth-sms` (Fastify)

- [x] Done: OTP rate limit on send: 1/60 s per phone, 5/hour per phone, 30/hour per IP (`src/rate-limit.ts`).
- [x] Done: OTP rate limit on verify: 5 attempts per code, 5 failed verifies in 15 min locks the phone for 1 hour, 30 verifies/5 min/IP (`src/lockout.ts`).
- [x] Done: constant-time verify with decoy HMAC on unknown phone (`src/routes/verify-otp.ts`).
- [x] Done: OTP secrets are HMAC-SHA256 hashes (`src/otp.ts`).
- [x] Done: OTP TTL 10 min, single use.
- [x] Done: JSONL audit log at `data/audit/otp.log.jsonl`, phone stored as truncated SHA-256 only, file mode 0600 (`src/audit.ts`).
- [ ] Partial: encryption at rest. `src/storage.ts` supports `AUTH_SQLITE_KEY` when better-sqlite3 is built against SQLCipher; the production binary is plain SQLite and the key is not set. Posture documented in `docs/32-auth-and-privacy.md`.
- [x] Done: WebOTP optional. The SMS body carries the `@host #code` suffix (`src/otp.ts`); the auth page autofills but accepts typed codes.
- [x] Done: Baileys auth state gitignored (`.gitignore` line 40). The directory does not exist on the box: WhatsApp runs through the Aiva gateway, not Baileys, so the 0700 rule has nothing to protect right now. Re-check if Baileys pairing is ever enabled.
- [x] Done: no gateway URL or token in client bundles. `apps/web/.env.example` has no `NEXT_PUBLIC_*` gateway values; the gateway client lives in `src/sms-gateway.ts` server-side.
- [x] Done: CORS allow-list from `AUTH_CORS_ORIGINS` (default tournamental.com, play, auth, localhost) with credentials (`src/index.ts`). Helmet registered.

### `apps/dm-otp` (Fastify, not deployed)

- [x] Done: 5-attempt cap and 5-minute TTL (`src/lib/code-store.ts`).
- [x] Done: per-subject lockout (`src/lib/brute-force.ts`).
- [x] Done: per-IP throttle with Retry-After.
- [x] Done: magic-link route shares the throttle.
- [ ] Open: move brute-force state to Redis when scaled. Still in memory; not needed while single-process.

### `apps/tournament-bot` (grammY, polling in production)

- [x] Done: Telegram webhook secret. `src/index.ts` refuses to start without `TELEGRAM_WEBHOOK_SECRET` and passes it to `registerTelegramWebhook`. The production unit runs in polling mode, so the webhook path is not exposed today.
- [x] Done: push caps server-side. 3 pushes/day per user plus quiet hours, match-day bypass only with opt-in (`src/rate-limit.ts`).
- [x] Done: affiliate CTA gated on country and explicit opt-in (`src/push/affiliate-cta.ts`: `geo_unknown` blocks, blocked-country lists, `notify_affiliate` flag). Country comes from the stored `country_code`, not `cf-ipcountry`, because the bot has no HTTP request to read it from.
- [ ] Partial: bot token never logged. The token is read once in `src/index.ts` and not echoed, but there is no pino `redact` config, so a future `log(err)` of a grammY error could include the request URL. Add `redact: ["req.url", "err.config.url"]` or equivalent.

## OTP brute-force protection (defence in depth)

Unchanged since May and still accurate for the app layer. The Cloudflare rules in `infra/cloudflare/otp-protection.sh` (send 10/min/IP challenge, verify 15/min/IP block 10 m, aggregate 30/min/IP block 1 h, ASN challenge, Bot Fight Mode) could not be re-verified from this box; confirming they are still applied needs the dashboard or an API token. Rollback stays `infra/cloudflare/otp-protection-revert.sh`.

| Layer | Window | Threshold | Action | Where |
| --- | --- | --- | --- | --- |
| Per-OTP attempts | until expiry | 5 | OTP deleted, 429 | `apps/auth-sms/src/lockout.ts` |
| Per-phone failures | 15 min | 5 | phone locked 1 h, 429 | same |
| Per-IP verifies | 5 min | 30 | 429 ip-throttled | same |
| Per-phone sends | 60 s and 1 h | 1 and 5 | 429 | `apps/auth-sms/src/rate-limit.ts` |
| Per-IP sends | 1 h | 30 | 429 | same |

Recovery for a locked-out real user is unchanged: `DELETE FROM rate_limit WHERE key LIKE 'verify:phone:+64...:%'` on auth.db, and the audit log records the lockout. The support address in the auth page copy must be info@tournamental.com (single mailbox rule); check `apps/web/app/auth/page.tsx` when next touched.

## B. Secrets

- [x] Done: `.env` and `.env.local` gitignored, plus `apps/*/.env.staging` and `apps/*/.env.production` (`.gitignore` lines 4, 5, 75, 76).
- [ ] Partial: backup copies. Two untracked `.env.*.bak-sendgrid-2026-10-15` files sit in the main checkout and are not ignored on `main`. PR #336 adds `.env.bak*` and `.env.*.bak*` to `.gitignore`. Until it merges, never `git add -A` in the main checkout.
- [x] Done: `.env.example` per service (18 files, root one lists 67 keys) with placeholders only; a scan for 20-plus-character values found none.
- [ ] Partial: gitleaks as a gate. `ci.yml` runs gitleaks and DCO as ordinary jobs, but `main` has no branch protection (GitHub API returns "Branch not protected"), so nothing is enforced as a required check. `pr-security.yml` (gitleaks extended, semgrep, licence audit) still runs with `continue-on-error` on its gate, the "soft launch" the file header describes.
- [ ] Open: Cloudflare token scope. Not verifiable from the repo or the box. Confirm in the dashboard that the tunnel token and any DNS token are zone-scoped.
- [x] Done: Polymarket ref URL is public; fine in client.
- [x] Done: ElevenLabs, OpenAI, Anthropic, HighLevel and SendGrid keys are read from `process.env` on the server only (`apps/web/lib/register-interest/ghl.ts`, `apps/web/lib/syndicate/ghl.ts`, `apps/auth-sms/src/sendgrid.ts`). No `NEXT_PUBLIC_` key carries a secret.
- [x] Done: BotFather token server-side only (`apps/tournament-bot/src/index.ts`).
- [ ] Open: SQLCipher keys from a `MASTER_KEY`. Not implemented; see auth-sms encryption at rest above. The `AUTH_SQLITE_KEY` hook exists, no rotation schedule.
- [x] Done: `TOURNAMENTAL_INTERNAL_SECRET` and `GAME_ADMIN_TOKEN` are set in the production env files (checked by key name only). Game admin routes default-deny when the token is unset (`apps/game/src/routes/auth.ts`, constant-time compare).

## C. Data and privacy

- [x] Done: PII handling documented in `docs/32-auth-and-privacy.md` (IPP mapping, erasure SLA, retention).
- [x] Done: privacy policy live at tournamental.com/legal/privacy (200 on 2026-10-17), single contact info@tournamental.com, retention per data class, post-deletion salted-hash retention explained.
- [ ] Partial: DSAR flow. Policy promises access and erasure on email request with a 30-day SLA; the operator steps live only as SQL in `docs/32` (session and user deletes). No runbook that also covers game.db (`register_interest`, picks, syndicates) or HighLevel.
- [ ] Partial: right to be forgotten. `apps/game/migrations/0001_init.sql` and later use `ON DELETE CASCADE` for user-owned rows, but no endpoint or script performs the delete end-to-end. `register_interest` keeps `ip_hash` and `user_agent`; PR #336 adds `deleteRegisterInterest(tournamentId, email)` in `apps/web/lib/register-interest/store.ts` for the per-email case.
- [x] Done: PII minimisation. Sign-in asks for a phone only. Register-interest asks for email, optional first name, country and phone, all optional except email and consent (`apps/web/app/api/v1/register-interest/route.ts`).
- [x] Done: analytics identifiers. GTM consent defaults are denied until the banner decision (`apps/web/components/analytics/GtmRoot.tsx`, `apps/marketing/src/components/Analytics.astro`); no phone or email is pushed to the dataLayer.
- [ ] Partial: cookie banner. `apps/web/components/analytics/ConsentBanner.tsx` offers "Accept" and "Only essential" globally. "Only essential" keeps analytics on and denies the ad flags, which is not a reject-all for EU purposes. The marketing site has no banner; it renders no analytics script at all when the ID is unset.
- [x] Done: NZ and AU users see no Polymarket CTA; UK gets the softened link (`apps/web/lib/odds/geo.ts` `POLYMARKET_BLOCKED_COUNTRIES`, read from `cf-ipcountry`).

## D. Bot abuse

- [ ] Open: Turnstile on every public write surface. None anywhere. Highest-value placements: the hub register-interest form (prize-draw entries) and, when live again, pick submission.
- [ ] Partial: bracket edit limits. Picks are locked at kickoff (`apps/game/src/routes/picks.ts`, 409 `match_already_started`) and writes are capped at 10/min per user per match (`PerMatchRateLimiter`). No 200-edits-per-tournament ceiling.
- [ ] Open: same-IP detection on high lock multipliers. `packages/bracket-engine/src/score.ts` computes the multiplier; nothing correlates IPs.
- [x] Done (code only): affiliate click throttling 30/min/IP and 3 per user per partner per 24 h (`apps/affiliate-router/src/storage.ts`). Service not deployed.
- [ ] Open: quiz answer dedupe. No quiz surface exists in `apps/game`.
- [x] Done (code only): WebSocket caps, 100 per IP and 5000 total by default (`apps/stream-server/src/config.ts`). Service not deployed.
- [x] Done: account creation throttled through OTP send limits (30/hour/IP, `apps/auth-sms/src/rate-limit.ts`); there is no separate `/v1/auth/request` limit in the game service because accounts are created by auth-sms.

## E. Smart contract (deferred)

Unchanged. Nothing under `packages/` or `apps/vstamp` deploys a contract yet. All six items stay open until docs/21 work starts.

## F. Build pipeline

- [ ] Partial: `pnpm audit`. Runs daily in `security-watchdog.yml` with `|| true` and feeds the watchdog roll-up; it does not fail a build. The May "zero high" claim was not re-measured here because this box does not run installs.
- [x] Done: Dependabot grouped weekly minor and patch for npm, plus actions and pip (`.github/dependabot.yml`). Nine Dependabot branches are open and unverified; see `docs/reviews/2026-10-branch-triage.md`.
- [ ] Partial: gitleaks and DCO run on every PR (`ci.yml`) but see section B: no branch protection, so they are advisory.
- [x] Done: lockfile checked in and CI installs with `--frozen-lockfile`.
- [ ] Open: `--no-verify` prevention. Nothing stops it locally; only server-side protection would.
- [x] Done: CI runs with `permissions: contents: read, pull-requests: read` (`ci.yml`); `pr-security.yml` declares its own minimal block.

## G. Incident response

- [x] Done: on-call is Tim. `infra/watchdog/check.sh` probes auth, play and game health every minute and alerts after three consecutive failures.
- [ ] Open: status page. `status.tournamental.com` does not resolve (curl returns no response), although the May engineering post promises it. Either stand one up or edit `apps/marketing/src/content/engineering/2026-05-14-build-on-tournamental.mdx`.
- [x] Done: alerting path exists (watchdog WhatsApp and email; `apps/security-watchdog` has Telegram, SMS and email sinks but is not running).
- [ ] Partial: runbooks. Rollback (`docs/cicd/02-rollback-runbook.md`) and incident flag (`docs/cicd/03-incident-flag-runbook.md`) exist. Host modes runbook is in PR #338. Missing: data breach, affiliate dispute, Polymarket downtime, Cloudflare outage.

## H. Host modes: live, hub and archive (added 2026-10-16)

One `apps/web` process serves three kinds of host, decided by `apps/web/lib/tournaments/registry.ts` and enforced in `apps/web/middleware.ts`. The archive host is the new read-only surface; the hub is the new write surface.

- [x] Done: every `POST`, `PATCH`, `PUT` and `DELETE` on an archive host returns 403 `{"error":"archived"}` before any route runs.
- [x] Done: live-only pages are bounced on archive hosts (`ARCHIVE_BLOCKED_PREFIXES`: auth, profile, manage, pools, syndicates, import, bot keys, invites, leaderboard, hub) and `/s/<id>/join` is blocked by pattern.
- [x] Done: hub mode serves only an allow-list (`HUB_ALLOWED_PREFIXES`: register-interest API, health, OG images, hub pages, static assets) and 302s everything else to the latest archive.
- [ ] Partial (fixed in PR #335): locale-prefixed paths skipped every host-mode rule, so `/fr/leaderboard` was served on the archive host and `/es` on play fell through. `routePathOf()` strips the locale before matching. Five of the 83 new tests fail on `main` until it merges.
- [ ] Partial (fixed in PR #336): the GET approve and deny links for join requests write state and were not caught by the mutating-method check on archive hosts. `ARCHIVE_BLOCKED_API` closes them.
- [ ] Partial: the `tnm_session` cookie is apex-scoped (`Domain=.tournamental.com`), so browsers still present it to archive hosts. No archive route mutates with it and the auth pages are blocked above, but a future archive page that reads the session would silently become personalised. Keep archive components session-free.
- [ ] Open: no security headers on either host (see `apps/web` above). Same fix.
- [x] Done: tests. PR #335 (`apps/web/__tests__/platform/`) covers aliases, 403 ordering against the CSRF check, blocked prefixes and segment boundaries, hub allow-list and invite links, and live mode with the registry mocked.

## I. Register-interest signup (hub, RWC 2027)

`POST /api/v1/register-interest` (`apps/web/app/api/v1/register-interest/route.ts`) writes `register_interest` in game.db (`apps/web/lib/register-interest/store.ts`, migration `apps/game/migrations/0017_register_interest.sql`) and mirrors to HighLevel (`lib/register-interest/ghl.ts`). The full review with 13 findings is `docs/reviews/2026-10-register-interest.md` (PR #336).

- [x] Done: honeypot field (`website`), per-IP limit 8 per 10 min with Retry-After, consent required, email and phone format checks, referral code must already exist, Origin guard from middleware, `Cache-Control: no-store`.
- [x] Done: PII stays server-side. IP is stored as a salted SHA-256 prefix (`hashIp`), user agent truncated, rows never logged.
- [x] Done: HighLevel push is best-effort with a 3 s timeout and never blocks the user; the API key is server-only.
- [ ] Partial (fixed in PR #336): a repeat submit for someone else's email could overwrite their name and phone and set their referral attribution, including self-referral. The store now only raises consent on an existing row.
- [ ] Partial (fixed in PR #336): no body size limit (8 KB cap added), `source_path` unvalidated (now a path regex), country sliced before validation, `created` leaked in the response, invite codes had modulo bias (rejection sampling added).
- [ ] Open: Turnstile and a global rate brake before the prize draw is announced (RI-06). Per-IP limits alone do not stop a distributed referral farm.
- [ ] Open: retention period and privacy wording for signup data (RI-10). The policy covers accounts, not pre-launch interest rows.
- [ ] Open: double opt-in in HighLevel before any marketing message, and only confirmed signups counting for referral entries (RI-12).
- [ ] Open: deploy. The fixes stay unreleased until PR #336 is merged, built and `tournamental-web` restarted.

## Threat model summary

| Threat | Probability | Impact | Mitigation today | Gap |
| --- | --- | --- | --- | --- |
| Bot signup flood on the hub form | High | Medium (prize draw integrity) | Honeypot, 8/10 min/IP, consent, referral validation | Turnstile, global brake, double opt-in |
| Referral attribution hijack | Medium | Medium | Fixed in PR #336 (no overwrite on repeat submit) | Merge and deploy |
| Affiliate click fraud | Medium | High (revenue) | Throttles in affiliate-router (code only) | Service not deployed; nothing to abuse yet |
| Archive host used to mutate | Low | Medium | 403 on mutating methods, blocked prefixes, PR #336 for GET writers | Merge PR #335 and #336 |
| Bracket data scraping | High | Low | Public by design; admin routes default-deny | None needed |
| Phone OTP brute force | Low | Medium | App-layer limits plus Cloudflare rules | Re-verify edge rules in the dashboard |
| Clickjacking or MIME sniffing on play | Low | Low | Nothing on play; nginx headers on marketing | Add headers in `next.config.mjs` |
| Secret leak via git | Low | High | gitleaks in CI, env files ignored | Branch protection; `.env.bak*` ignore (PR #336) |
| Polymarket programme closure | Low | Critical (revenue) | Provider abstraction (docs/30) | Unchanged |
| NZ DIA enforcement | Low | Critical (legal) | Geo gate on `cf-ipcountry`, NZ and AU hidden | Unchanged |
| Cloudflare or tunnel outage | Low | High | Single tunnel `tournamental` | No secondary tunnel; no status page |

## Sign-off

- [ ] Tim reviews this checklist before each launch (next: RWC 2027 go-live, after the registry flip in `apps/web/lib/tournaments/registry.ts`).
- [ ] Reviewer posts the diff against the previous run as a PR comment (this run: PR for `docs/security-checklist-refresh`).
- [ ] Failed items become tickets in `tasks/in-progress/` with owner and ETA. Suggested first three: security headers on play (small, no risk), branch protection on `main` with gitleaks and DCO required, Turnstile on the hub form before the prize draw goes public.
