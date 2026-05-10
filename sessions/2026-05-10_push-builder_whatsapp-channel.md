# 2026-05-10 — push-notifications: add WhatsApp channel

Branch: `feat/push-whatsapp-channel`
Worktree: `/home/clawdbot/clawdia/projects/vtorn-push-wa`
Status: complete

## Plan

Add a WhatsApp channel adapter to `apps/push-notifications` that mirrors
the existing SMS/Telegram/Web-Push adapter contract, pluss:

- `POST /v1/subscribe/whatsapp` with `consent: true` required.
- Wire WhatsApp into the dispatcher fan-out for `kickoff_soon`,
  `match_result`, `leaderboard_move`.
- Add `PUSH_PREFERRED_CHANNEL=auto|whatsapp|sms` policy (default `auto`).
  In `auto`, WhatsApp wins over SMS when both are linked.
- Mirror every WA send into a dedicated `data/whatsapp-audit.jsonl` log
  with the recipient phone masked to last 4 digits.
- Tests for the adapter, the consent guard, the auto-prefer policy, and
  the masked audit log.

## Decisions

- Reused `AivaWhatsAppClient` from `@vtorn/auth-sms` via a new `./whatsapp`
  package export so the same Baileys session powers both OTP and pushes.
  Added a `// TODO: migrate to @vtorn/aiva-client` once that workspace
  package lands on origin/main.
- `WhatsAppPushSender` accepts a `transport` override so tests inject a
  mock without spinning up the gateway. When `AIVA_SMS_API_KEY` /
  `AIVA_WA_SESSION_ID` are unset, the sender falls back to a stub note in
  the audit (matches the SMS / Web-Push stub behaviour).
- Audit fan-out uses a new `TeeAuditLogger` so WA sends land in both the
  WA-only file and the main `audit.jsonl` trail.
- Dispatcher returns `'suppressed'` (not `'skipped'`) for the channel
  that the policy intentionally skipped — operators can grep for it.

## Verification

- `pnpm typecheck` clean.
- `pnpm test --run` clean — 32 tests, 13 of them new (`test/whatsapp.test.ts`).
- Server boots on :3398. Manual curl:
  - `POST /v1/subscribe/whatsapp` returns `{ ok: true }` and refuses
    requests without `consent: true`.
  - `POST /v1/notify/kickoff_soon` returns `whatsapp: 'sent'` for a user
    subscribed only to WhatsApp; `data/whatsapp-audit.jsonl` shows
    `"to":"+*******4567"` (masked).

## How to test send-via-WA without spamming a real number

The default stub path is intentionally non-transmitting: with
`AIVA_SMS_API_KEY` or `AIVA_WA_SESSION_ID` unset, the adapter only writes
to `data/whatsapp-audit.jsonl` and returns ok. Two safer paths to verify
real sends:

1. Start a local mock gateway (any HTTP responder that 200s
   `POST /api/v1/whatsapp/sessions/:id/send`) and point the service at
   it: `AIVA_SMS_API_URL=http://localhost:9999 AIVA_SMS_API_KEY=test
   AIVA_WA_SESSION_ID=test pnpm dev`.
2. Inject a custom transport in tests via
   `WhatsAppPushSender({ transport: { send, pairingQr, shutdown } })` —
   that's the path `test/whatsapp.test.ts` uses.

## Refs

- `apps/push-notifications/src/lib/whatsapp.ts`
- `apps/push-notifications/src/lib/dispatcher.ts`
- `apps/push-notifications/src/lib/audit.ts` (TeeAuditLogger)
- `apps/push-notifications/src/lib/subscriptions.ts` (WhatsAppRecord)
- `apps/push-notifications/src/routes/subscribe.ts` (POST /v1/subscribe/whatsapp)
- `apps/push-notifications/src/index.ts` (wiring + env policy)
- `apps/push-notifications/test/whatsapp.test.ts`
- Refs: `apps/auth-sms/src/whatsapp-baileys.ts` for the underlying client.
