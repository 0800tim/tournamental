# dm-otp builder — initial build

- Task: build apps/dm-otp Fastify service on :3393 for user-initiated DM-OTP login across Telegram, WhatsApp, Messenger, and Instagram.
- Status: complete; all tests + typecheck green; server boots; healthz 200.
- Refs: docs/32-auth-and-privacy.md, apps/auth-sms (OTP + JWT origin), apps/tournament-bot (Telegram precedent).

## Plan
1. New Fastify app on port 3393 with the four webhook endpoints + verify + start-info.
2. Reuse `generateOtpCode` and JWT shape from auth-sms (copy-with-TODO into shared package — auth-shared not yet created).
3. In-memory `CodeStore` keyed by code, 5-min TTL, single-use claim semantics.
4. JSONL audit log at `data/dm-otp-issued.jsonl` with masked code (`*****1`) and masked external IDs (`***1234`).
5. Reply adapters under `lib/replies/` with a `_send` seam so tests don't fire real HTTP.
6. Webhook signature verification BEFORE any dispatch into the code generator.

## Decisions
- userId emitted as `dm:{channel}:{externalId}` — deterministic synthetic ID. Identity-merge is a downstream concern (apps/identity).
- Verify endpoint accepts an optional `channel` for defence-in-depth; if supplied it must match the minted code's channel.
- Both Meta endpoints (Messenger + Instagram) share a handler factory; only the path, channel name, expected `object` field, and reply adapter differ.
- Fastify's default JSON parser drops the raw body; replaced with a wrapper that attaches `req.rawBody` so HMAC verification (Aiva, Meta) can run on the exact bytes.
- Stub reply adapters get installed when env vars are missing so a single-channel mis-config doesn't take down all four webhooks.

## TODOs (filed in IDEAS.md candidate list)
- Lift `generateOtpCode` + JWT signer into `packages/auth-shared` once a third consumer appears.
- Persist `CodeStore` to Redis once we deploy multiple instances of dm-otp.
- Wire dm-otp's `dm:{channel}:{externalId}` into apps/identity so the JWT's `sub` resolves to a canonical user.
- TikTok intentionally absent: no inbound-DM API for normal accounts.

## Test surface (vitest)
- code-store: put/claim, single-use, expiry, collision.
- signatures: Telegram secret, Aiva HMAC, Meta HMAC.
- issue: trigger pattern, 6-digit format, masked code, formatted message body.
- webhook-telegram: 401 without/with-wrong header; 200 + reply on "log in"; ignores non-trigger; ignores non-private chats.
- webhook-whatsapp: 401 without signature; happy path with valid HMAC; jid-suffix stripping.
- webhook-meta: GET subscription verify; 401 without signature; messenger vs instagram routing; is_echo ignored.
- verify: 400 bad body; happy path JWT shape; replay 401; expired 401; channel-mismatch 401.
- start-info: returns the four deep-links exactly; 60s public + 300s s-maxage.

## Quality gates
- `pnpm typecheck` clean.
- `pnpm test --run` 59/59 green.
- Server boots on :3393; `GET /healthz` 200.

## Next steps
- Tim provisions the env vars listed in the PR body.
- Tim subscribes the Meta webhooks in the App Dashboard.
- Add `/login` command to apps/tournament-bot in a separate concern (not this PR).
