# Session — tournament-bot WhatsApp parity

- **Agent**: tournament-bot-builder
- **Task**: add WhatsApp parity to `apps/tournament-bot` via the Aiva gateway, alongside the existing Telegram (grammY) flow
- **Docs**: `docs/13-telegram-bot-and-auth.md` (referenced via README), `apps/auth-sms/src/whatsapp-baileys.ts` (Aiva client shape), `apps/identity/src/lib/providers/telegram.ts` (link pattern)
- **Status**: complete
- **Branch**: `feat/tournament-bot-whatsapp`

## Plan

1. Extract command logic into a source-agnostic dispatcher (`lib/dispatch.ts`) that takes `{ source, sourceId, userKey, text }` and returns reply text. Keeps command intent in one place.
2. Refactor existing grammY handlers to delegate to the dispatcher — single source of truth.
3. Add a slim WhatsApp Aiva HTTP client (`whatsapp/aiva-client.ts`) — send-only, no Baileys dep.
4. Add `whatsapp/handler.ts` — Fastify route at `POST /v1/webhooks/aiva-wa` that HMAC-verifies the body before dispatch.
5. Wire boot in `index.ts` so WhatsApp comes up only when `AIVA_WA_SESSION_ID` + `AIVA_WEBHOOK_SECRET` are set; Telegram works regardless.
6. Tests: dispatcher routes both sources, webhook signature verification (good and bad), leaderboard reply formatting.

## Decisions

- **Storage** — re-use the existing `tg_user` table for WA users too, keyed on a synthetic `chat_id` derived from a stable hash of the JID. Avoids a schema migration; future v0.2 can split into `bot_user` with a `(source, source_id)` PK.
- **Dispatcher contract** — returns a `DispatchReply` (`{ text, parse_mode? }`). The transport layer translates that into either a grammY `ctx.reply` or an Aiva `sendMessage`.
- **Signature** — `X-Signature: sha256=<hex>` over the raw request body using `AIVA_WEBHOOK_SECRET`. Constant-time compare. Rejected with 401 before any payload parsing.
- **Reply format** — strip Telegram-specific Markdown (`*bold*`, backticks) for WhatsApp, since WA renders `*bold*` differently and ignores backticks. Done in the WA outbound adapter, not the dispatcher.
- **Don't break Telegram** — the grammY bot keeps running as before; refactor is internal. All existing tests pass unchanged.

## Open questions for orchestrator

1. Final webhook path — `/v1/webhooks/aiva-wa` matches the doc-22 `/v1/webhooks/...` namespace; flag if you'd prefer `/v1/whatsapp/webhook` to mirror Telegram.
2. Should we eventually persist WA user identity in a separate `wa_user` table? Current shim is fine for parity but hides the source.

## Outcome

- `pnpm typecheck` clean
- `pnpm test --run` clean (existing 50 tests + new dispatcher / webhook / formatter tests)
- Telegram path verified via existing tests — no regressions
- WhatsApp webhook accepts signed inbound, rejects unsigned/bad-sig, runs dispatcher

## Next steps

- Wire push helpers (kickoff/goal) to also fan out to WA — out of scope for this PR; tracked in IDEAS.md.
- Persist a `wa_user` row distinct from `tg_user` once the bot has more than dev traffic.
