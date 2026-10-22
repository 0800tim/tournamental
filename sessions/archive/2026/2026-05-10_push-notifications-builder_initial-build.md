# 2026-05-10 — push-notifications builder — initial build

## Task

Build `apps/push-notifications`: a Fastify service on **:3398** that fans
match-event notifications out to Web Push, Telegram, and SMS, with a
kickoff scheduler that arms `kickoff - 30min` and `kickoff - 5min`
notifications for every fixture in the upcoming 24h.

## Plan executed

1. Reviewed `apps/auth-sms/src/sms-gateway.ts` for the Aiva SMS client
   shape and replicated it as a stub (`src/lib/sms.ts`) so the swap from
   stub to real client is mechanical.
2. Reviewed `apps/tournament-bot/src/push/kickoff.ts` for the Telegram
   send pattern and stubbed it the same way (`src/lib/telegram.ts`).
3. Web Push adapter (`src/lib/web-push.ts`) follows the W3C Push
   Subscription JSON shape so the `web-push` npm package drops in later.
4. `SubscriptionStore` is in-memory with append-on-write JSONL persistence
   plus tombstones (so `remove` survives restart).
5. `Scheduler` walks `Tournament.group_fixtures` + `knockouts`, schedules
   `setTimeout` jobs in the next 24h, persists job state to disk for
   idempotent restart, and skips already-passed lead times as `expired`.
6. Routes live in `src/routes/{subscribe,notify}.ts`. Every subscribe
   endpoint validates `consent: true` via Zod literal — fail-closed.
7. Audit log writes every adapter call + every subscribe to
   `data/audit.jsonl` so we have a complete trail while sends are stubbed.

## Tests

19 tests across three files:
- `server.test.ts` — every route, fan-out across 3 channels, internal
  secret enforcement, audit log records correct events.
- `scheduler.test.ts` — past kickoffs skipped, 24h-window kickoffs scheduled
  twice (one per lead time), idempotent re-load, expired jobs not fired,
  `onFire` callback invoked.
- `subscriptions.test.ts` — JSONL round-trip across all three channels,
  tombstone replay on remove, picks per match.

```
pnpm typecheck → clean
pnpm test       → 19/19 passing
server boot     → :3398 healthy, /v1/version returns 0.1.0
```

## Env required for production

| Group     | Vars                                                            |
|-----------|-----------------------------------------------------------------|
| Web Push  | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`         |
| Telegram  | `TELEGRAM_BOT_TOKEN` or `TOURNAMENT_BOT_PUSH_URL` + `_SECRET`    |
| SMS       | `AIVA_SMS_API_URL`, `AIVA_SMS_API_KEY`, `AIVA_SMS_DEVICE_ID`     |
| Auth      | `PUSH_INTERNAL_SECRET` (gates `/v1/notify/*`)                    |

## Status

`status: complete`. Adapter swap from stub to real-network is the next
piece of work; tracked as Phase 2 once Tim provisions the keys above.

## Next steps

- Replace `StubWebPushSender.send` with `webpush.sendNotification(...)`.
- Replace `StubTelegramSender.send` with grammY or POST to tournament-bot.
- Replace `StubSmsSender.send` with the Aiva fetch from `auth-sms`.
- Wire the Game service to call `/v1/picks/record` and the notify
  endpoints — `/v1/picks/record` is the temporary seam for v0.1.
