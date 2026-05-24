# 61 — HighLevel (GoHighLevel) CRM integration

> **Status: live (contacts + pools-on-contact).** Pools-as-custom-objects
> and the admin dashboard deep-link target are planned — see
> [62-admin-dashboard.md](62-admin-dashboard.md).

Tournamental mirrors its users and pools into a GoHighLevel (GHL)
sub-account so marketing can run drips, segments and broadcasts against
real players. This doc is the single source of truth for **what syncs,
from where, when, and how to operate it**.

## 1. The sub-account and credentials

Everything writes to one GHL **sub-account (location)**. We authenticate
with a **Private Integration Token** (the `pit-...` key), which GHL treats
as a full OAuth-scoped integration.

| Variable           | Where                              | Meaning                                            |
| ------------------ | ---------------------------------- | -------------------------------------------------- |
| `GHL_API_KEY`      | `apps/web`, `apps/auth-sms`, `apps/crm-bridge` | Sub-account private-integration token (`pit-...`). |
| `GHL_LOCATION_ID`  | same                               | The sub-account/location id (e.g. `kTxB57bk…`).    |
| `GHL_API_BASE_URL` | same (optional)                    | Defaults to `https://services.leadconnectorhq.com`. **No trailing slash.** |

All requests send `Version: 2021-07-28` and `Authorization: Bearer <key>`.

> ⚠️ **`GHL_API_BASE_URL` foot-gun.** The deployed env had this set
> *present-but-empty*. `process.env.X ?? default` does **not** fall back on
> `""`, so the base URL became `""` and every contact `POST` hit the
> relative URL `/contacts/…`, which throws in `fetch`. That silently queued
> every syndicate signup for retry and created zero contacts. The clients
> now use `process.env.X || default` and strip trailing slashes. Keep it
> that way.

## 2. What lives where

| Concern                              | Service          | File                                          |
| ------------------------------------ | ---------------- | --------------------------------------------- |
| **Identity sync** (player contacts)  | `apps/auth-sms`  | `src/highlevel.ts`                            |
| Registration triggers                | `apps/auth-sms`  | `src/routes/{verify-otp,magic-verify,email-otp,telegram-callback}.ts` |
| Profile-edit trigger                 | `apps/auth-sms`  | `src/routes/session.ts` (`PATCH /v1/auth/me`) |
| Custom-field provisioning            | `apps/auth-sms`  | `scripts/highlevel-setup.ts`                  |
| One-off backfill                     | `apps/auth-sms`  | `scripts/backfill-highlevel.ts`               |
| **Pool/syndicate owner sync**        | `apps/web`       | `lib/syndicate/ghl.ts`, `app/api/v1/syndicates/route.ts` |
| Syndicate retry queue                | `apps/web`       | `scripts/ghl-retry.ts`                        |
| Rich lifecycle (predictions, ranks)  | `apps/crm-bridge`| `src/lib/ghl-client.ts` (event-driven)        |
| Premium tier webhook (inbound)       | `apps/web`       | `app/api/v1/webhooks/highlevel/premium-status/route.ts` |

**Why identity lives in auth-sms, not crm-bridge:** auth-sms owns the
canonical `user` row (phone / email / name) and the `highlevel_contact_id`
/ `highlevel_synced_at` columns. crm-bridge owns the *richer* lifecycle and
is event-driven + mock-by-default. Coupling first-touch contact creation to
crm-bridge uptime would mean a registering user might not land in the CRM.

## 3. Contact model

Every contact is keyed by **email/phone** (GHL's upsert contract). We use
`POST /contacts/upsert` everywhere so re-syncs and retries never duplicate.

### Tags

| Tag                 | Applied to                                   | Set by                       |
| ------------------- | -------------------------------------------- | ---------------------------- |
| `player`            | Every registered user.                       | `auth-sms/src/highlevel.ts`  |
| `syndicate_owner`   | Anyone who created a pool.                    | `web/lib/syndicate/ghl.ts`   |
| `has_pool`          | Anyone who owns ≥1 pool (segment helper).     | `web/lib/syndicate/ghl.ts`   |
| `tournament:<id>`   | Scopes a pool owner to a tournament.          | `web/lib/syndicate/ghl.ts`   |

### Custom fields

Provisioned by `scripts/highlevel-setup.ts` (idempotent). GHL **silently
drops** custom-field values whose key doesn't resolve to a defined field,
so the field must exist before the value sticks. The upsert references
fields by their short key (GHL maps `vtourn_user_id` → `contact.vtourn_user_id`).

| Field key (sent)        | GHL fieldKey                  | Meaning                                       |
| ----------------------- | ----------------------------- | --------------------------------------------- |
| `vtourn_user_id`        | `contact.vtourn_user_id`      | Internal user id, links contact ↔ user.       |
| `vtourn_admin_url`      | `contact.vtourn_admin_url`    | Deep link to the admin dashboard user page.   |
| `vtourn_pool_ids`       | `contact.vtourn_pool_ids`     | Pool/syndicate id(s) the contact owns.        |
| `syndicate_slug`        | `contact.syndicate_slug`      | Pool slug (syndicate funnel).                 |
| `syndicate_role`        | `contact.syndicate_role`      | `owner` \| `member`.                          |
| `syndicate_tournament`  | `contact.syndicate_tournament`| Tournament id of the pool.                    |
| `syndicate_tier`        | `contact.syndicate_tier`      | `free` \| `premium` \| `past_due` (HL-owned). |
| `marketing_opt_in`      | `contact.marketing_opt_in`    | Marketing consent (`true`/`false`).           |
| `sponsor_contact_consent` | `contact.sponsor_contact_consent` | Sponsor-share consent (`true`/`false`).  |
| `vtourn_affiliate_code` | `contact.vtourn_affiliate_code` | Affiliate's referral code (see [64](64-affiliate-highlevel.md)). |
| `vtourn_affiliate_url`  | `contact.vtourn_affiliate_url`| Affiliate's shareable referral URL.           |
| `vtourn_referred_by`    | `contact.vtourn_referred_by`  | Referral code that referred this contact.     |

All 12 fields are **provisioned live** in the location (run
`scripts/highlevel-setup.ts` to (re)create any missing). The affiliate
fields are groundwork — no affiliate data flows yet (the affiliate product
is not built; see [64](64-affiliate-highlevel.md)).

## 4. When syncs fire

```
First sign-in (phone OTP / magic link / email OTP / Telegram)
  └─ findOrCreate*User()  ── void syncUserToHighLevel() ──▶ upsert `player`
                                                            └─ writeback highlevel_contact_id

Profile edit  PATCH /v1/auth/me  (display_name / first/last / country / email changed)
  └─ updateUser() ── void syncUserToHighLevel() ──▶ re-upsert same contact

Pool created  POST /api/v1/syndicates
  └─ pushToGhl(row) ──▶ upsert `syndicate_owner` + `has_pool`, pool fields
                        └─ on failure: enqueue syndicates_pending_ghl (cron retry)
```

**Best-effort, never blocks.** The identity sync is fire-and-forget
(`void syncUserToHighLevel(...)`); it never throws into the request path
and, when `GHL_API_KEY` is unset (dev/test), it short-circuits to
`skipped` and makes no network call. The syndicate push has a 3s timeout
and a dead-letter retry queue.

**No sync loop.** The contact-id writeback only touches the `highlevel_*`
columns, which are *not* identity fields, so it can never re-trigger the
profile-change sync.

## 5. Operations

All commands run from `apps/auth-sms` with the GHL vars in `.env`.

```bash
# Provision custom fields on a sub-account (idempotent; safe to re-run):
pnpm --filter @vtorn/auth-sms exec tsx scripts/highlevel-setup.ts --env-file=.env
#   add --dry-run to preview only.

# Backfill already-registered users as `player` contacts:
pnpm --filter @vtorn/auth-sms exec tsx scripts/backfill-highlevel.ts \
  --env-file=.env --db=./data/auth.db            # DRY RUN (no writes)
pnpm --filter @vtorn/auth-sms exec tsx scripts/backfill-highlevel.ts \
  --env-file=.env --db=./data/auth.db --live     # writes to GHL + DB
#   add --force to re-sync rows that already have a highlevel_contact_id.

# Drain the syndicate retry queue (run from cron, ~every 15 min):
pnpm --filter @vtorn/web exec tsx scripts/ghl-retry.ts
```

The backfill is **idempotent**: it skips rows that already carry a
`highlevel_contact_id` (unless `--force`), and the endpoint is an upsert,
so re-running it can't create duplicates. Only **contactable** users
(phone or email present) are synced; pure-guest/anonymous bracket savers
in `apps/game/data/game.db` have no contact details and are out of scope.

## 5a. Bogus-number filter

`isPlausiblePhone()` in `src/highlevel.ts` keeps obvious test/junk numbers
(`+1 333 333 3333`, sequential digits, etc.) out of HighLevel. Rules
(deliberately conservative — it never rejects a plausible real number):

- 8–15 digits (E.164 bounds);
- more than 2 distinct digits (kills `3333333333`, `1212121212`);
- no run of 7+ identical digits; no `1234567890` / `9876543210` sequences.

Behaviour: a user whose **only** handle is a bogus phone is **skipped** (not
pushed). A user with a bogus phone **and** an email is pushed on the email
with the phone omitted. Real phones are always kept — they feed outbound
messaging via the **Aiva SMS / WhatsApp** gateway integrated with HighLevel.
The same filter governs the backfill, so re-runs never re-introduce junk.

> Real numbers are intentionally retained even before a display name is set,
> because the phone is the messaging handle.

### Name capture at signup (built)

`apps/web/components/auth/ProfileCompletionGate.tsx` (mounted in the root
layout) shows a one-time popup after an inbound user signs in with an empty
profile. It collects avatar (via `AvatarUploader`), **display name**
("how you'll appear on leaderboards"), first name, and email (when missing).
It PATCHes `/v1/auth/me`, which triggers the profile-edit re-sync in §4 — so
the name/email land on the HighLevel contact automatically. Phone is not
captured here (it's a login credential needing OTP, not a free-text field).

## 6. Known gaps / next phase

- **Pools are stored on the owner's contact**, not as first-class objects.
  The richer model is GHL **Custom Objects** (a `pool` object per syndicate
  with its own fields, related to the contact). Planned in
  [62-admin-dashboard.md](62-admin-dashboard.md) because it's only useful
  alongside the admin UI.
- **`owner_user_id` is `null`** on public syndicate signups
  (`app/api/v1/syndicates/route.ts`) — the pool attaches to the user *in
  HighLevel* (same contact by email/phone) but our own DB doesn't link
  pool → user yet. Fix tracked in the admin-dashboard plan.
- **crm-bridge duplication.** `web/lib/syndicate/ghl.ts` is a deliberately
  narrow copy of the crm-bridge client (see its header). Post-launch, route
  the syndicate push through crm-bridge and delete the copy.

## 7. Operator setup — automated vs manual

GHL's API lets us automate contacts, tags, and custom fields, but **not**
pipelines, workflows, products, or sub-account provisioning — those are
UI/agency-only. Here's the split.

### ✅ Automated / already live (no action needed)

- **12 custom fields** provisioned in the location (`scripts/highlevel-setup.ts`).
- **Contact sync**: registration → `player`, profile edits, pool owners →
  `syndicate_owner`/`has_pool` — live on the `auth-sms` service.
- **Backfill** of existing players: done (one-off, re-runnable).
- **Bogus-number filter**: live; junk test contacts removed.
- **Name-capture popup**: built (ships with the next `web` deploy).

### 🔧 Manual — you do these in the HighLevel dashboard

The API can't create these. Each has a detailed spec; work through them in
order:

1. **Pipelines + stages** — build "Pool Owner Nurture" (6 stages) and
   optionally "Player Activation". Spec: [63 §3](63-highlevel-nurture-and-pipelines.md).
2. **Workflows** — W1–W6 (welcome, grow-your-pool, thriving/referral,
   at-risk, pre-tournament, player activation), with email/SMS templates.
   Spec: [63 §5](63-highlevel-nurture-and-pipelines.md) + the private
   runbook (`tournamental-business/commercial/highlevel-setup-runbook.md`).
3. **Smart lists** — empty-pool owners, owners-by-tournament, players-no-pool.
   Spec: [63 §6](63-highlevel-nurture-and-pipelines.md).
4. **Premium $97 product + order form + SaaS/agency billing** — commercial;
   needs the **agency API key**. Spec: the private runbook +
   `tournamental-business/commercial/highlevel-premium-form-and-product.md`.
5. **Opportunity hook (code)** — once Pipeline A exists, copy its
   `pipelineId` + stage id into env and wire opportunity creation on pool
   signup. Snippet: [63 §4](63-highlevel-nurture-and-pipelines.md).
6. **Affiliate workflows** — only once the affiliate product is designed +
   built. Spec: [64](64-affiliate-highlevel.md).

A single consolidated, tick-box version of this manual list (including the
commercial steps) lives privately at
`tournamental-business/commercial/highlevel-manual-setup-checklist.md`.

## 8. Deployment status (2026-05-24)

- **`auth-sms`** (registration/profile sync): **deployed live** — one shared
  process (`vtorn-auth-sms`) serves dev + prod, restarted with GHL creds.
- **`apps/web`** (syndicate upsert fix + name-capture popup): merged to
  `main`, **not yet deployed** — pending a clean `web` build/deploy.
- **GHL account**: custom fields + backfilled contacts are live (one
  location, no dev/prod split).
