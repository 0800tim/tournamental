# @vtorn/crm-bridge

Fastify service that forwards VTourn lifecycle events into GoHighLevel as
a single contact-per-user with custom fields and tags. Also serves a
customer-360 aggregate endpoint for the admin UI.

Port: **3395** (see `docs/22-deployment-and-tunnels.md`).
GHL secrets: `GHL_LOCATION_ID`, `GHL_API_KEY`
(see `docs/25-keys-and-secrets-required.md`).

## v0.1 status

The GoHighLevel HTTP client is **mocked**. Every upsert / tag /
custom-field operation is appended to `data/ghl-calls.jsonl`. Wiring the
real API is a follow-up — see TODO at the bottom.

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

- Real GoHighLevel HTTP client (`lib/ghl-client.ts` interface stays
  stable — only the implementation flips).
- Read `GHL_LOCATION_ID` + `GHL_API_KEY` at boot and fail fast on absence
  in production.
- Retry + exponential backoff with a dead-letter queue on persistent
  GHL failures.
- Idempotency keys on the wire (we already enforce dedupe in-memory; the
  real client should pass `eventId` as the GHL idempotency key).
- GDPR / RTBF endpoint: `DELETE /v1/customer/:userId` that purges the
  in-memory cache, the JSONL log line, and the live GHL contact.
- Promote in-memory store to Postgres once we have a single instance to
  share state across replicas.
