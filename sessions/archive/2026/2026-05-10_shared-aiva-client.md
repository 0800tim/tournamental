# Session: shared @vtorn/aiva-client package

**Branch**: `feat/shared-aiva-client`
**Status**: complete

## Task

Lift the canonical Aiva SMS + WhatsApp clients out of `apps/auth-sms/src/`
into a shared workspace package `packages/aiva-client/`, then wire
`apps/push-notifications` to use the real client (replacing its local stub).

## Plan

1. Read the auth-sms canonical impls + push-notifications stub.
2. Scaffold `packages/aiva-client` mirroring `packages/spec-client` shape.
3. Lift `AivaSmsClient` + `StubSmsClient` + `AivaWhatsAppClient` +
   `StubWhatsAppClient` + their config helpers + the `SmsSender` /
   `WhatsAppSender` type unions verbatim.
4. Keep `LocalBaileysClient` in `apps/auth-sms` (heavy local-only dep).
5. Replace auth-sms canonical files with re-export shims so existing
   internal imports keep working.
6. Replace the push-notifications SMS stub with an `AivaSmsAdapter`
   that picks the real or stub client at construction time.
7. Add a privacy-masked SMS-only audit JSONL (`data/sms-audit.jsonl`)
   that never logs more than the last 4 phone digits.
8. Tests: hermetic `fetch`-mock tests for both clients, plus push-side
   tests that prove the real client is wired when env is set.

## Outcome

- `packages/aiva-client@0.1.0` published to the workspace.
- 23 new tests (sms + whatsapp).
- 7 new push-notifications adapter tests covering env-driven mode
  selection and audit-mask behaviour.
- All workspace tests pass: 1538 across 24 packages.
- Boot-test confirmed: stub mode logs `[stub-sms] would-send`; with
  AIVA env set, the gateway is hit (and writes `mode:"aiva"` to the
  audit JSONL — `errorCode:"network"` when the URL is bogus, as
  expected).

## Downstream consumers

- **Now**: `apps/auth-sms`, `apps/push-notifications`.
- **Should be next**:
  - `apps/crm-bridge` — broadcast cohort SMS / WhatsApp messages on
    drip-list events. Currently has no outbound channel; switching to
    `@vtorn/aiva-client` is a one-import change.
  - `apps/tournament-bot` — fallback SMS / WhatsApp delivery when
    Telegram is unavailable. The bot already imports `bracket-engine`
    and `spec-client` from the workspace; adding `aiva-client` is the
    same pattern.

## Audit-log policy

`apps/push-notifications/data/sms-audit.jsonl` is now the canonical
SMS-only privacy audit. One line per send (real or stub):

```json
{"ts":"2026-05-10T08:23:09Z","userId":"u-test","event":"kickoff_soon","recipientLast4":"****4567","template":"kickoff_soon","length":63,"status":"ok","mode":"aiva"}
```

Phone numbers are masked to `****####` (last 4 digits) before they
ever reach the audit file. The cross-channel audit log
(`data/audit.jsonl`) was also updated to mask the SMS `to` field.

## Files

- `packages/aiva-client/` — new package.
- `apps/auth-sms/src/sms-gateway.ts` — re-export shim.
- `apps/auth-sms/src/whatsapp-baileys.ts` — re-export shim + local Baileys.
- `apps/push-notifications/src/lib/sms.ts` — `AivaSmsAdapter` (stub alias kept).
- `apps/push-notifications/src/index.ts` — uses `AivaSmsAdapter` + new `smsAuditPath` option.
- `apps/push-notifications/test/sms.test.ts` — new adapter tests.
