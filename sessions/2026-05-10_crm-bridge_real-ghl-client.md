# 2026-05-10 — CRM bridge: real GoHighLevel client backend

**Branch:** `feat/crm-real-ghl-client`
**Doc refs:** `docs/25-keys-and-secrets-required.md`, `apps/crm-bridge/README.md`
**Status:** in-progress

## Plan

1. Promote `lib/ghl-client.ts` to a barrel that exports a `GhlClient` interface
   (extended with `addTag`, `removeTag`, `setCustomField`, `getContact`) plus
   `MockGhlClient` (existing behaviour) and a new `RealGhlClient`.
2. `RealGhlClient` uses `fetch` against
   `https://services.leadconnectorhq.com` with headers:
   `Authorization: Bearer ${GHL_API_KEY}`, `Version: 2021-07-28`,
   `Accept: application/json`, `Content-Type: application/json`.
   Location id is sent in the body for `POST /contacts/upsert` and used to
   namespace lookups.
3. Selection in `server.ts`: `CRM_BACKEND` env (`mock` | `real`). When `real`
   is selected without `GHL_API_KEY` or `GHL_LOCATION_ID`, throw on boot.
4. Idempotency: every event handler already passes an eventId. We record it
   as the `vtourn_last_event_id` custom field per upsert. Update aggregate +
   custom-field key list.
5. Retry/backoff: 429 / 5xx triggers up to 3 attempts with 1s/2s/4s. On
   final failure, append `{ ts, op, payload, error }` to
   `data/ghl-failed.jsonl`.
6. New endpoint `POST /v1/admin/replay-failed` — bearer-token authed against
   `CRM_ADMIN_TOKEN`, walks the failed log line-by-line, replays each entry,
   rewrites the file with whichever lines still failed.
7. Tests: `tests/ghl-real-client.test.ts` mocks `globalThis.fetch` to assert
   header shape, body shape, retry count, backoff cap, and failure-log
   append. No network.

## Out of scope (parked in IDEAS.md if unaddressed)

- Real GHL OAuth refresh-token flow (we use a static private-integration
  token for now per docs/25).
- Custom-field id-to-key resolution: GHL's API takes either custom-field
  `id` or `key` in the upsert payload. We send `key` since that's what
  Tim's location is configured with; mapping table can land later.

## Next steps after this PR

- Wire the real backend in staging, run a smoke event, verify the contact
  arrives in GHL with the expected custom fields + tags.
- Add a small admin UI button in `apps/admin` to call `replay-failed`.
