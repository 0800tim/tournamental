# @vtorn/push-notifications

VTourn's push-notifications service. Fastify on **:3398**. Fans match-event
notifications out to **Web Push (browsers)**, **Telegram**, **WhatsApp**
(via the Aiva gateway, sharing the auth-sms Baileys session), and **SMS**
(via Aiva). Keeps a kickoff scheduler running so users get a "your match
starts in 30 / 5 min" ping for everything they've picked.

> **v0.1 status:** all channel adapters are stubs that write to
> `data/audit.jsonl`. None of them actually transmit. Wire the real
> back-ends behind the same interfaces when production keys are
> provisioned (see `.env.example`).

## Run

```bash
pnpm -F @vtorn/push-notifications dev
# server: http://localhost:3398
```

## Endpoints

### Health
- `GET /healthz` — liveness probe
- `GET /v1/version` — build version, pending-job count, subscriber count

### Subscribe (consent: true required on every body)
- `POST /v1/subscribe/web-push` — body `{ userId, consent: true, subscription }`
- `POST /v1/subscribe/telegram` — body `{ userId, consent: true, telegramUserId }`
- `POST /v1/subscribe/sms` — body `{ userId, consent: true, phone }`
- `POST /v1/subscribe/whatsapp` — body `{ userId, consent: true, phone }`

### Notify (gated by `x-push-secret` if `PUSH_INTERNAL_SECRET` set)
- `POST /v1/notify/kickoff_soon` — `{ matchId, minutesUntil }`
- `POST /v1/notify/match_result` — `{ matchId, outcome, scoreboard?, pointsForWin? }`
- `POST /v1/notify/leaderboard_move` — `{ userId, fromRank, toRank, tournamentId }`
  - Only fires if `fromRank - toRank >= 5`.

### Picks (internal — temporary until Game service exists)
- `POST /v1/picks/record` — `{ matchId, userId, outcome }`

## Storage

- `data/subscriptions.jsonl` — append-only subscription + pick log; replayed on boot.
- `data/audit.jsonl` — append-only audit log (every adapter call, every subscribe).
- `data/whatsapp-audit.jsonl` — WhatsApp-only mirror of the audit log.
  Every WA send appends here as well as to the main audit. Phone numbers
  are stored masked (`+*******4567` style — last 4 digits only).
- `data/scheduled-jobs.json` — scheduler state for idempotent restart.

## Scheduler

On startup the service loads the FIFA WC 2026 fixtures via
`@vtorn/bracket-engine` and arms two `setTimeout` jobs per fixture in the
upcoming 24h window: `kickoff - 30min` and `kickoff - 5min`. Each fired
job fans out a `kickoff_soon` notification to everyone who recorded a pick
for that match. State is persisted to disk so a restart re-arms only the
still-pending jobs.

## Channel-preference policy

Set `PUSH_PREFERRED_CHANNEL` to control how SMS and WhatsApp interact for a
user who has linked both. Web Push and Telegram are unaffected.

| `PUSH_PREFERRED_CHANNEL` | Behaviour                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `auto` (default)         | WhatsApp wins when linked (cheaper + higher open rate). Falls back to SMS otherwise.       |
| `whatsapp`               | WhatsApp only. SMS-only users receive nothing.                                             |
| `sms`                    | SMS only. WhatsApp-only users receive nothing.                                             |

The dispatcher returns `'suppressed'` for the channel that was skipped due
to the policy (vs `'skipped'` when the user simply has no subscription).

## Env

See `.env.example`. The required-for-production groups are:
- Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Telegram: `TELEGRAM_BOT_TOKEN` (or `TOURNAMENT_BOT_PUSH_URL` + `_SECRET`)
- SMS: `AIVA_SMS_API_URL`, `AIVA_SMS_API_KEY`, `AIVA_SMS_DEVICE_ID`
- WhatsApp: `AIVA_SMS_API_URL`, `AIVA_SMS_API_KEY`, `AIVA_WA_SESSION_ID`
  (shares the URL + key with the SMS gateway; the session id is the paired
  Baileys session on the gateway dashboard)
- Routing: `PUSH_PREFERRED_CHANNEL=auto|whatsapp|sms` (default `auto`)
- Auth: `PUSH_INTERNAL_SECRET` (gates the `/v1/notify/*` routes)

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/push-notifications.openapi.json`](../../docs/api/push-notifications.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/push-notifications run dump-openapi
# or @vtourn/odds-ingest / @vtorn/wc2026-data-scripts
```
