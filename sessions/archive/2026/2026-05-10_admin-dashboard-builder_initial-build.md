# 2026-05-10 — Admin dashboard initial build

**Agent**: admin-dashboard builder
**Branch**: `feat/admin-dashboard` (from `origin/main` 39a3189)
**Status**: ready-for-review

## Task

Build the VTourn admin dashboard at `apps/admin/` per the task brief —
internal ops console for users, syndicates, content, tournaments, and
analytics. Subdomain `admin.vtourn.com`, dev port 3340. Auth via magic
link to an `ADMIN_EMAILS` allowlist with three RBAC roles.

Refs:
- `docs/23-analytics-and-marketing-insights.md` (admin dashboard surfaces)
- `docs/30-gamification-and-affiliate-spine.md` (leaderboards, affiliate funnel)
- `docs/13-telegram-bot-and-auth.md` (auth model)
- `docs/20-identity-humanness-bots.md` (humanness score)

## What landed

1. **`apps/admin/`** — new Next.js 14 + Tailwind app, dark theme by
   default, port 3340. Dependencies: `next 14.2.15`, `react 18`,
   `recharts`, `@tanstack/react-table`, `jose` (for JWT signing).
2. **Auth** — magic-link via `lib/auth.ts` with three providers in
   `lib/mailer.ts` (`log` for dev, Resend, Mailgun). 8h JWT session in
   an `__Host-admin` HttpOnly cookie (production) / `admin-session`
   (dev). Edge middleware (`middleware.ts`) gates everything except
   `/login` and `/api/auth/*`. `requireAuth()` server-side helper
   redirects to `/login?next=` on missing session.
3. **RBAC** — `lib/perms.ts` defines 18 named permissions across three
   roles: `super-admin`, `mod`, `viewer`. Sidebar hides items the role
   can't access; route handlers default-deny.
4. **Pages** — overview, users (list + detail + ban dialog), syndicates,
   tournaments, fixtures, content, affiliate, analytics, feature-flags,
   api-keys, audit-log, settings. Every page is a server component
   wrapped in `requireAuth()`.
5. **Components** — `Sidebar`, `StatCard`, `DataTable` (TanStack Table:
   sortable + filterable + paginated), `BanDialog`, `HumannessChip`,
   `GeoMap` and `RevenueChart` (Recharts).
6. **API routes** — `/api/auth/{request,callback,logout}`,
   `/api/users/[id]/{ban,unban}`, `/api/feature-flags/[key]`. All
   mutating routes append to the audit log and call into a thin
   `lib/api.ts` BFF that forwards short-lived signed JWTs to the
   eventual `/v1/admin/*` upstream on `apps/api`.
7. **Apps/api stub** — `apps/api/src/routes/admin.ts` is a documented
   skeleton enumerating every endpoint the BFF expects, plus a
   pre-handler verifier sketch for the cross-service JWT.
8. **Migration** — `apps/api/migrations/0001_admin_tables.sql` adds
   `admin_users`, `admin_audit_log`, `admin_feature_flags`.
9. **Tests** — 60+ Vitest + RTL specs across `__tests__/components/`,
   `__tests__/lib/`, and `__tests__/pages/`. Two Playwright e2e specs
   (`login` and full `admin-flow`, the latter gated on `ADMIN_E2E=1`).

## Auth hardening notes

- **Default deny**: empty `ADMIN_EMAILS` → login disabled. Login form
  surfaces a red banner and the request endpoint responds 503.
- **Enumeration defence**: `/api/auth/request` always returns 200, never
  reveals whether the email is allowlisted.
- **Re-check on every request**: `readSession()` re-checks the allowlist
  even after issuing the cookie, so removing an admin from the env var
  takes effect on next request.
- **Throttled magic-link requests**: 5/min per IP, in-memory throttle.
  Real rate limiting belongs at Cloudflare; this is the cheap defence.
- **`__Host-` cookie prefix in production** for CSRF resistance + Secure
  flag enforcement.
- **HMAC-signed audience-bound JWTs** for both the magic link
  (audience `admin-magic-link`) and the session (audience
  `admin-session`). Cross-audience tokens are rejected.
- **Cross-service JWT** to `apps/api`: 60-second TTL, audience
  `vtorn-api-admin`. The admin BFF mints these per-request rather than
  forwarding the user cookie.
- **Read-only settings**: editing the admin allowlist from inside the
  console is intentionally not implemented (privilege-escalation
  hazard). Allowlist edits go through env config + deploy.

## DNS + tunnel-add command

```bash
# Run on the host with the existing aiva-tunnel + cf-api-token.
bash infra/scripts/cf-add-vtourn-hosts-admin.sh
```

The new helper script is a copy-of-pattern of
`infra/scripts/cf-add-vtourn-hosts.sh` that adds:

```
{ hostname: "admin.vtourn.com", service: "http://localhost:3340" }
```

…to the existing tunnel ingress, then creates the matching CNAME on
`vtourn.com` → `<tunnel-id>.cfargotunnel.com`. Implementation lives in
the same PR.

## Recommended mailer

Start with **Resend**. The free tier (100 emails/day) is more than
enough for internal admin auth, the API is a single POST per email,
and the React Email compatibility lets us upgrade templates later.
Mailgun is already an env in the admin app for projects that have an
existing Mailgun account configured.

## Open questions

1. **Final RBAC matrix**: confirm the three-tier model (`super-admin /
   mod / viewer`) is the right vocabulary, vs the alternative
   `owner / operator / read-only`.
2. **Per-tenant scopes**: when syndicates ship native owners, does the
   admin role need a syndicate-scoped variant (e.g. "Creator-League
   admin can moderate only their own pool")? Currently we treat all
   admins as platform-global.
3. **Audit-log retention**: Postgres partition by month (per docs/23
   events table) or unbounded with manual archival? Recommend monthly
   partition with a 12-month retain window.
4. **Bot policies surface**: docs/23 describes a "switchboard for
   engagement bands → outreach". Not implemented yet; punted to the
   next sprint after `apps/bots/` lands.
5. **Live counters**: docs/23 calls for sub-1s update on the live
   widgets. Currently rendered server-side per request; wiring a
   Server-Sent Events feed off the Redis stream is a follow-up PR.

## Next steps

- Land this PR.
- Wire the upstream `/v1/admin/*` handlers in `apps/api` once the
  Fastify server shell is in place.
- Add a Server-Sent Events `/api/live` route for the overview live
  counters.
- Layer in a syndicate-scoped admin role (open question #2) before
  Creator League NZ goes live.
