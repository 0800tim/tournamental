# Session: HighLevel integration — contacts, pools, custom fields, backfill

status: in-progress (code complete + verified; not committed; awaiting Tim go-ahead)
branch: worktree-highlevel-integration
date: 2026-05-24

## Task

Make user registrations and syndicate/pool signups create + update HighLevel
contacts (they weren't). Backfill existing users. Add custom fields, pool
linking, a bogus-number filter. Document the integration + admin dashboard +
nurture pipelines. Write a HighLevel community announcement.

## Root causes found

- **Registration never synced to HighLevel.** `auth-sms` had
  `highlevel_contact_id`/`_synced_at` columns but nothing populated them.
- **Syndicate push silently broken.** `GHL_API_BASE_URL` was set
  *present-but-empty*; `?? default` doesn't fall back on `""`, so the fetch
  URL became relative and every push failed → queued. Fixed with `|| default`
  + trailing-slash strip, and switched to `/contacts/upsert` (idempotent).

## Done (live + verified)

- `apps/auth-sms/src/highlevel.ts` — new client: upsert `player` contact,
  custom fields `vtourn_user_id` + `vtourn_admin_url`, bogus-phone filter
  (`isPlausiblePhone`), DB writeback. Fire-and-forget, never blocks login.
- Wired into all registration paths (verify-otp, magic-verify, email-otp,
  telegram-callback) + profile-edit re-sync (session.ts PATCH).
- `apps/web/lib/syndicate/ghl.ts` — base-URL fix + upsert + `has_pool` tag +
  `vtourn_pool_ids`. All 10 create-route tests pass.
- `scripts/highlevel-setup.ts` — idempotent custom-field provisioning. Ran
  live: 6 fields exist (vtourn_user_id/admin_url/pool_ids + syndicate_*).
- `scripts/backfill-highlevel.ts` — dry-run default, `--live`. **Ran live:
  14/14 contactable users synced** (incl. Theo, Molly, Tim); DB writeback
  14/14.
- **Cleanup:** deleted 6 repeated-digit junk contacts + the John Doe
  smoke-test from HighLevel (HTTP 200; verified gone).
- `test/highlevel.test.ts` — 7 passing unit tests (filter + payload).

## Docs written

- `docs/61-highlevel-integration.md` — full integration reference.
- `docs/62-admin-dashboard.md` — admin dashboard PLAN (not executed) +
  pools-as-Custom-Objects upgrade.
- `docs/63-highlevel-nurture-and-pipelines.md` — pipelines/opportunities/
  workflows plan (pipelines + workflows are UI-only; opportunities scriptable).
- `../tournamental-business/commercial/highlevel-integration-announcement.md`
  — community/letter copy.
- `../tournamental-business/commercial/highlevel-premium-form-and-product.md`
  — $97 product + signup form + agency-billing addendum to the runbook.

## Baseline issue (NOT mine)

The branch base (origin/main @ 9302de6) already fails `tsc` (13 errors:
AuditAction enum, two missing Storage methods) and 6 tests (cookie
`SameSite`, OTP single-use, rate-limit). Confirmed identical with my edits
stashed. Likely another agent mid-flight. My code is type-clean and tested.

## Next steps / open

1. **Commit + PR** — awaiting Tim's go-ahead (dev-first rule). Env files
   (.env.local/.production base URL, auth-sms .env GHL block) edited in the
   MAIN checkout, not committed (gitignored).
2. **Name capture at signup** — front-end prompt for display/first name on
   first sign-in. Backend already re-syncs names on profile edit.
3. **Pipelines/workflows** — build in HL UI per docs/63 (API can't create).
4. **Premium $97 SaaS** — needs agency API key; planned in the business docs.
5. Stale `highlevel_contact_id` on the 6 deleted junk users (harmless; they
   re-skip on future sync due to bogus phone).

## Notes for merge-cleanliness

Work is isolated to `apps/auth-sms/*` and `apps/web/lib/syndicate/ghl.ts` +
`docs/61-63`. No overlap with the in-flight i18n/cookie work on main.
