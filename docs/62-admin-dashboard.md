# 62 - Admin dashboard

> **Status: SHIPPED 2026-05-28.** Live at https://admin.tournamental.com.
> Auth is WhatsApp-OTP step-up; perimeter Cloudflare Access is queued
> (Tim) for a follow-up day. Data is read directly from auth.db +
> game.db via better-sqlite3 - apps/api is **not** in the loop.

## 1. Why

We have real users registering and creating pools, but no internal
surface to see and manage them at a glance. This dashboard is that
surface: who's signing up, which pools exist, which are public vs
private, what prizes are on the line, and a one-click "ack of life"
across every Tournamental service.

## 2. Auth

Two-layer gate:

1. **(Future) Cloudflare Access** on `admin.tournamental.com` - gates
   the perimeter via Tim's Google/GitHub OIDC. Not yet configured;
   Tim will add the policy in the CF dashboard when he next sits
   down. Until then the OTP gate alone is the security boundary.
2. **In-app WhatsApp OTP step-up**. The flow:
   - Visit `/login` → "Send code" button (no inputs; phone is
     hardcoded server-side so an attacker who clears CF Access still
     can't direct OTPs to a number they control).
   - The admin server POSTs `/v1/auth/request` on `auth-sms` with the
     hardcoded phone (`ADMIN_PHONE_E164`) and `channel: whatsapp`.
   - WhatsApp delivers a 6-digit code.
   - Operator enters the code; admin POSTs `/v1/auth/verify-by-code`
     server-side, checks the returned `user.id` against
     `ADMIN_ALLOWED_USER_IDS`, mints an `admin_session` JWT (HS256,
     24h ttl) and sets it as `__Host-admin` (prod) / `admin-session`
     (dev).
   - On cookie expiry → bounce back to `/login`.

The auth-sms response cookie (`tnm_session`) is intentionally not
propagated to the browser: admin is a separate authority domain. A
user signed into `play.tournamental.com` must not automatically
become admin, and vice versa.

Code:
- `apps/admin/lib/auth.ts` - JWT issue / read / require + helpers
- `apps/admin/app/api/auth/request/route.ts` - proxy to auth-sms
- `apps/admin/app/api/auth/verify/route.ts` - proxy + allowlist gate
- `apps/admin/middleware.ts` - public-path list + redirect to /login

## 3. Surfaces

| Route                       | Data source                                          |
| --------------------------- | ---------------------------------------------------- |
| `/`                         | Overview, real counts from auth.db + game.db, plus a one-line summary + recent signups / pools |
| `/users`                    | auth-sms users (display, phone, country, joined); CSV export |
| `/users/[id]`               | auth-sms user + game.db brackets + pools owned/joined + customer-360 |
| `/syndicates`               | game.db syndicates: visibility, tier, prize, owner; CSV export |
| `/syndicates/[slug]`        | + members from `syndicate_owners_membership` (joined via auth.db for display names) |
| `/pundits`                  | Top brackets by score for a given tournament         |
| `/broadcast`                | Pick pools + playbook → WhatsApp/email (dry-run live)|
| `/tournaments`              | game.db tournaments                                  |
| `/fixtures`                 | mocks (Tournament fixtures - speculative)            |
| `/content`                  | mocks                                                |
| `/highlevel`                | GHL CRM live snapshot: total contacts, drift, tag breakdown, recent contacts |
| `/market`                   | Polymarket tournament-winner probabilities (via apps/odds-ingest) |
| `/affiliate`                | mocks                                                |
| `/operators`                | mocks                                                |
| `/advertisers`              | mocks                                                |
| `/analytics`                | mocks (Funnel chart - speculative)                   |
| `/feature-flags`            | mocks                                                |
| `/api-keys`                 | game.db user_api_keys                                |
| `/audit-log`                | `.admin-audit.jsonl` (append-only on disk)           |
| `/system`                   | live ping of each tournamental.com service           |
| `/settings`                 | env config readout (phone, allowlist, DB paths)      |

## 4. Data architecture

The admin app reads sqlite files **directly** in read-only mode via
better-sqlite3 (`apps/admin/lib/db.ts`). This is allowed by the
co-located-services exception in CLAUDE.md §"Cross-service reads":
auth-sms, game-service, and the admin app all run on the same host
in production, and the indirection through apps/api would not pay
for itself for a read-mostly operator tool.

Writes go through the canonical service's HTTP API. The admin app
never mutates a foreign DB itself.

Connections are cached at module scope; one read-only handle per file.

## 5. Broadcast

Operator picks one or many syndicates, selects a playbook template
(seed templates: welcome, kickoff, winner-payout) or writes a custom
markdown body, previews the rendered message per recipient, and
sends via WhatsApp + optionally email to each pool's owner.

**Status of live send**: auth-sms does not yet expose a generic
`send-broadcast` endpoint. Dry-run is fully wired; the live send path
returns `not_implemented_yet` while still writing one `writeAudit`
row per intended recipient so the action is logged. When auth-sms
ships the broadcast endpoint, the admin route swaps in the live
transport with no UI changes.

Templates: `apps/admin/data/playbooks/<name>.md`, YAML front-matter
(`name`, `description`, `recommended`, `default_channels`) plus a
markdown body with `{{pool_name}}`, `{{owner_handle}}`,
`{{tournament}}`, `{{member_count}}` substitution slots.

## 6. System health

`/system` pings each Tournamental service (play, game, auth,
marketing, admin) with a 4.5s timeout and shows status + latency.
Refresh re-probes. Red rows are degraded. Useful first stop when
diagnosing anything.

## 7. Environment

Required in production (`apps/admin/.env.production`, gitignored):

```bash
ADMIN_PHONE_E164=+6421535832
ADMIN_ALLOWED_USER_IDS=u_be5a445cff4347f6ae6089
ADMIN_JWT_SECRET=<64+ random chars>
ADMIN_AUTH_SMS_BASE_URL=https://auth.tournamental.com
ADMIN_AUTH_DB_PATH=/home/.../apps/auth-sms/data/auth.db
ADMIN_GAME_DB_PATH=/home/.../apps/game/data/game.db
```

Adding a new operator: append their auth-sms user id to
`ADMIN_ALLOWED_USER_IDS` and restart `vtorn-admin-prod`. There's no
in-app surface for this on purpose; editing it would create a
privilege-escalation hazard.

## 8. Deployment

- pm2: `vtorn-admin-prod` on port 3340 (entry registered with
  `pm2 save` 2026-05-28).
- Cloudflared tunnel: ingress `admin.tournamental.com → http://localhost:3340`,
  added via the CF tunnel-configurations API.
- DNS: `admin` CNAME → `<tunnel-id>.cfargotunnel.com`, proxied.

Rebuild + redeploy:
```bash
cd apps/admin && pnpm exec next build
pm2 restart vtorn-admin-prod --update-env
```

## 9. What's deliberately not built

- **No in-app allowlist editor.** Adds a privilege-escalation vector.
- **No mass-user-banning UI.** Per-user ban exists; bulk operations
  go through a CLI to make audit obvious.
- **No write-through API for `apps/api`.** The BFF chain in the
  original scaffold was nice for type-safety but slow to build out;
  direct sqlite reads were the cheaper path for shipping in one
  night. If we ever need a *foreign* admin client (mobile?), the
  BFF can be revived later.

## 10. Follow-ups

- Cloudflare Access policy on the perimeter (Tim).
- `auth-sms /v1/auth/send-broadcast` so live broadcast sends work
  end-to-end (today's dry-run is fully functional).
- Bracket-engine cascade in `/market` so we can render "community pick"
  histogram alongside the Polymarket favourites.
- Cloudflare Zone Analytics on `/system` once the CF token gains the
  `Zone.Analytics:Read` scope.
- One-click "resync to HighLevel" button on user detail (needs a
  matching admin route in auth-sms).
- Real data for the remaining mock surfaces (operators, advertisers,
  affiliate, analytics) when the upstream services ship.
- Member growth chart on the syndicate detail page.
- Global cmd+k search across users and pools.

## 11. Integrations wired

| Integration         | Surface(s)                  | Auth                                   |
| ------------------- | --------------------------- | -------------------------------------- |
| auth-sms user DB    | overview, users, broadcast  | direct sqlite read (co-located)        |
| game-service DB     | overview, syndicates, pundits, api-keys, broadcast | direct sqlite read (co-located) |
| HighLevel CRM       | `/highlevel`                | `GHL_API_KEY` Bearer + Version 2021-07-28 |
| Polymarket (mirror) | `/market`                   | direct sqlite read of `apps/odds-ingest/data/odds-ingest.sqlite` |
| WhatsApp OTP        | login + `/broadcast` send   | auth-sms `/v1/auth/request` + verify  |
| Service health      | `/system`                   | HTTPS HEAD with 4.5s timeout          |
