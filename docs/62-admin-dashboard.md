# 62 — Admin dashboard (PLAN — not yet built)

> **Status: PLAN ONLY. No code exists for this yet.** This document is the
> design to execute later. It also specifies the HighLevel deep-link target
> that [61-highlevel-integration.md](61-highlevel-integration.md) already
> writes into the `vtourn_admin_url` custom field, and the "pools as GHL
> Custom Objects" upgrade.

## 1. Why

We have real users registering and creating pools, but no internal surface
to **see and manage them**. Today the only window is the GHL contact list.
We need an admin area to:

- Look up a user (by phone / email / name / id) and see their profile,
  pools, predictions, humanness score, and HighLevel sync state.
- See every pool, its owner, members, size band, tournament and status.
- Act: rename/flag a user, soft-disable a pool, resync to HighLevel,
  resend an auth link.
- Be the **landing target** for the `vtourn_admin_url` link on every GHL
  contact, so a marketer in HighLevel can click straight through to the
  Tournamental record.

## 2. Who can access

Admins only. The allowlist primitive already exists: `TNM_ADMIN_USER_IDS`
(used by `apps/web/app/api/v1/admin/hl-status/route.ts`). Reuse it; do not
invent a second admin model. All admin routes are `private, no-store` and
gated server-side on the authenticated session's user id ∈ allowlist.

## 3. Surface (routes)

Proposed under `apps/web/app/admin/*` (server components) with a thin
`apps/web/app/api/v1/admin/*` data layer.

| Route                      | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `/admin`                   | Overview: counts (users, pools, synced %), recent signups. |
| `/admin/users`             | Searchable, paginated user list.                           |
| `/admin/users/:id`         | **The `vtourn_admin_url` target.** Profile + pools + sync. |
| `/admin/pools`             | Pool list with owner, tournament, size, status.            |
| `/admin/pools/:slug`       | Pool detail: members, settings, owner contact.             |

**Deep-link contract (already emitted, keep stable):**
```
vtourn_admin_url = {ADMIN_DASHBOARD_URL}/users/{userId}
                   default ADMIN_DASHBOARD_URL = https://play.tournamental.com/admin
```
If the admin app is later hosted on its own origin (e.g.
`admin.tournamental.com`), set `ADMIN_DASHBOARD_URL` in `apps/auth-sms`
env — the custom-field value follows automatically. Do not change the path
shape (`/users/:id`) without re-backfilling the field.

## 4. Data sources

The admin app is read-mostly and aggregates across services:

| Data            | Source                                             |
| --------------- | -------------------------------------------------- |
| Users / profile | `apps/auth-sms` `user` table (auth.db).            |
| Pools           | syndicate persistence (`apps/game` sqlite).        |
| Predictions/rank| `apps/game` + crm-bridge aggregate.                |
| Humanness score | identity service (doc 20).                         |
| HL sync state   | `highlevel_contact_id` / `highlevel_synced_at`.    |

Cross-service reads should go through each service's HTTP API, not direct
DB reach-in, except where a service is co-located. Respect the caching
rules in [22-deployment-and-tunnels.md](22-deployment-and-tunnels.md):
admin list endpoints are `private, no-store`.

## 5. Prerequisite fix: link pool → user in our own DB

Today `POST /api/v1/syndicates` sets `owner_user_id: null` ("No auth on the
public signup yet"). For the admin pool→owner join to work natively (not
just via the shared GHL contact), the signup must capture the authenticated
user id:

1. Require an authenticated session on pool creation (the form already
   gates on auth; the route must read and persist the session user id).
2. Persist `owner_user_id` on the syndicate row.
3. Backfill existing rows where the owner email/phone matches a `user`.

This is the same "create account before pool" invariant the product owner
expects; the code doesn't currently enforce it at the route.

## 6. Pools as GHL Custom Objects (upgrade)

Today a pool is mirrored as **tags + custom fields on the owner's contact**
(`has_pool`, `vtourn_pool_ids`, `syndicate_*`). That's enough to segment
and deep-link, but it can't represent a pool as its own record with members
and its own lifecycle.

The richer model uses **GHL Custom Objects**:

- Define a `pool` custom object on the location (fields: slug, name,
  tournament, size band, status, member count, created date).
- Create/associate a `pool` record per syndicate, **related to** the owner
  contact (and later, member contacts).
- The admin pool page links out to the GHL custom-object record, and vice
  versa.

**Why gated:** Custom Objects need schema design + a migration of existing
pools, and they're only worth it once the admin UI consumes them. Build the
admin app first, then upgrade pools from contact-fields to Custom Objects.
Until then, the contact-field model in doc 61 stands.

## 7. Build sequence (when greenlit)

1. **Admin shell + auth gate** (`/admin`, allowlist, layout).
2. **Users**: list + detail, reading auth.db via auth-sms API. Wire the
   `vtourn_admin_url` target so HighLevel click-through lands correctly.
3. **Pool → user link fix** (section 5) so pools attach to owners.
4. **Pools**: list + detail.
5. **Actions**: resync-to-HL, resend-auth-link, flag/disable (audited).
6. **Pools-as-Custom-Objects** upgrade (section 6).

## 8. Out of scope for this plan

Billing/premium management (handled by the GHL premium webhook, doc 61 §2),
and any end-user-facing surface. This is an internal operator tool only.
