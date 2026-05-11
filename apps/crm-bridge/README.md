# @vtorn/crm-bridge

Fastify service that forwards Tournamental lifecycle events into GoHighLevel as
a single contact-per-user with custom fields and tags. Also serves a
customer-360 aggregate endpoint for the admin UI.

Port: **3395** (see `docs/22-deployment-and-tunnels.md`).
GHL secrets: `GHL_LOCATION_ID`, `GHL_API_KEY`
(see `docs/25-keys-and-secrets-required.md`).

## Backends

Selected via the `CRM_BACKEND` env var:

| `CRM_BACKEND` | Behaviour |
| --- | --- |
| `mock` *(default)* | All operations append a JSONL record to `data/ghl-calls.jsonl`. No network. |
| `real` | HTTP calls to `https://services.leadconnectorhq.com` with `Bearer ${GHL_API_KEY}`, `Version: 2021-07-28`, `LocationId: ${GHL_LOCATION_ID}`. |

When `CRM_BACKEND=real`, both `GHL_API_KEY` and `GHL_LOCATION_ID` must be
set; otherwise the bridge throws at boot with a clear error rather than
silently degrading.

The real backend retries 429 / 5xx up to **3 times** with exponential
backoff (1s, 2s, 4s). On final failure, the call is appended to
`data/ghl-failed.jsonl` (configurable via `CRM_GHL_FAILED_LOG_PATH`) so
it can be replayed by hitting the admin endpoint:

```bash
curl -X POST https://crm.tournamental.com/v1/admin/replay-failed \
  -H "Authorization: Bearer ${CRM_ADMIN_TOKEN}"
```

The replay endpoint is a no-op (`501`) on the mock backend.

## Endpoints

- `POST /v1/events/user_signup` — `{ eventId, userId, email?, phone?, country?, source }`
- `POST /v1/events/prediction_locked` — `{ eventId, userId, matchId, outcome, oddsAtLock, ts }`
- `POST /v1/events/syndicate_joined` — `{ eventId, userId, syndicateSlug, role, ts }`
- `POST /v1/events/bracket_shared` — `{ eventId, userId, channel, ts }`
- `POST /v1/events/match_settled` — `{ eventId, userId, matchId, deltaPoints, newRank, ts }`
- `GET /v1/customer/:userId` — customer-360 aggregate (events + would-be GHL contact).
- `GET /healthz` `GET /version` `GET /` — health + identity.

Every event handler is **idempotent on `eventId`**. A duplicate POST
returns `200 { accepted: false, reason: "duplicate_event" }` and does not
re-issue a GHL upsert.

## Custom fields synced

| Field | Source |
| --- | --- |
| `vtourn_user_id` | constant: the `userId` |
| `vtourn_last_event_id` | originating `eventId` of the most recent upsert (real backend) |
| `humanness_score` | placeholder `0` (real value lands with the identity service, doc 20) |
| `total_predictions` | count of `prediction_locked` events |
| `current_rank` | latest `match_settled.newRank` |
| `syndicates` | CSV of distinct `syndicateSlug` values, first-join order |
| `last_pick_at` | ISO of latest `prediction_locked.ts` |
| `last_lock_in_odds_avg` | running mean of `oddsAtLock` |
| `device_country` | latest non-empty `country` from signup |

## Tags applied

- `tournament:wc2026` — once any event lands.
- `made_pick` — once a prediction is locked.
- `evangelist` — after at least one bracket share.
- `syndicate:<slug>` — per syndicate join.

## Run

```bash
pnpm --filter @vtorn/crm-bridge dev
curl http://localhost:3395/healthz
```

## Test

```bash
pnpm --filter @vtorn/crm-bridge test
pnpm --filter @vtorn/crm-bridge typecheck
```

## TODO (production readiness)

- Map GHL custom-field **ids** alongside **keys** so the upsert payload
  can be sent against locations that haven't aliased keys yet.
- Real GHL OAuth refresh-token flow (currently a static
  private-integration token).
- GDPR / RTBF endpoint: `DELETE /v1/customer/:userId` that purges the
  in-memory cache, the JSONL log line, and the live GHL contact.
- Promote in-memory store to Postgres once we have a single instance to
  share state across replicas.
- Search-by-email/phone helper (`/contacts/search`) for backfill
  scenarios where we have to look up by identity instead of contactId.

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/crm-bridge.openapi.json`](../../docs/api/crm-bridge.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/crm-bridge run dump-openapi
# or @tournamental/odds-ingest / @vtorn/wc2026-data-scripts
```
