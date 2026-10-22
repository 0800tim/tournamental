# 2026-05-10 — dm-otp channel expansion

**Task**: Build the DM-OTP login service framework + 16 channel adapters
(4 original + 12 expansion).

**Branch**: `feat/dm-otp-channel-expansion`
**Worktree**: `/home/clawdbot/clawdia/projects/vtorn-dm-otp-more`
**Status**: complete — typecheck clean, 60 tests passing, server boots,
`/v1/auth/dm-otp/channels?include=all` returns 16 channels.

## Plan

1. Inspect sibling agent's worktree (`vtorn-dm-otp`); finding minimal
   scaffolding only (`otp.ts` + package.json), so build the full
   framework + all 12 expansion channels in this worktree.
2. Lay out `apps/dm-otp/` with `lib/replies/<channel>.ts`,
   `routes/webhooks/<channel>.ts`, shared `code-store`, `jwt-issuer`,
   `dispatcher`, `signatures`.
3. Public surfaces: `GET /v1/auth/dm-otp/channels`,
   `GET /v1/auth/dm-otp/start-info`, `POST /v1/auth/dm-otp/verify`,
   `GET /v1/auth/dm-otp/email/click`.
4. Tests: signature verification (per scheme), code-store TTL +
   single-use + lockout, dispatcher, adapter HTTP shape via mock fetch,
   route-level integration with raw-body capture for HMAC.
5. Update `docs/22-deployment-and-tunnels.md` to add port 3331.

## Channels delivered

| #  | Channel    | Status        | Sig scheme                        | Inbound mode               |
| -- | ---------- | ------------- | --------------------------------- | -------------------------- |
| 1  | Telegram   | available     | X-Telegram-Bot-Api-Secret-Token   | webhook                    |
| 2  | WhatsApp   | available     | X-Hub-Signature-256 (Meta)        | webhook                    |
| 3  | Messenger  | available     | X-Hub-Signature-256 (Meta)        | webhook                    |
| 4  | Instagram  | available     | X-Hub-Signature-256 (Meta)        | webhook                    |
| 5  | Discord    | available     | Ed25519 over (timestamp\|\|body)  | interactions endpoint      |
| 6  | X (Twitter)| partner_gated | x-twitter-webhooks-signature      | Account Activity API + CRC |
| 7  | Reddit     | available     | poll-forwarder bearer             | inbox poll (every 30s)     |
| 8  | Threads    | available     | X-Hub-Signature-256 (Meta)        | webhook                    |
| 9  | Slack      | available     | X-Slack-Signature v0              | Events API                 |
| 10 | Mastodon   | available     | poll-forwarder bearer             | streaming-API forwarder    |
| 11 | LINE       | available     | X-Line-Signature                  | webhook                    |
| 12 | Viber      | available     | X-Viber-Content-Signature         | webhook                    |
| 13 | Teams      | available     | dev: bearer / prod: JWT (TODO)    | Bot Framework activity     |
| 14 | LinkedIn   | partner_gated | (returns 503 until access lands)  | n/a                        |
| 15 | Signal     | available     | poll-forwarder bearer             | signal-cli REST poll       |
| 16 | Email      | available     | Mailgun timestamp+token+signature | Mailgun route webhook      |

## Skipped (documented in PR body)

- TikTok DM (partner-only API)
- iMessage (no public API; Apple Business Chat partner-only)
- Snapchat (no DM API)
- WeChat (China-registered entity required)
- Bluesky (DMs not yet shipped in AT Protocol)
- Skype (consumer messaging deprecated)
- Google Chat (workspace-only)
- Kakao (Korea-registered business required)

## Verification

```
$ pnpm typecheck   # clean
$ pnpm test        # 60 passed (60)
$ curl /v1/auth/dm-otp/channels?include=all  # 16 channels
```

## Notes for future sessions

- Discord uses interactions endpoint; a separate gateway-bot worker
  is needed to forward plain DM events into the interactions shape.
- Teams webhook accepts a dev-mode shared bearer; production needs
  full Bot Framework JWT validation against
  https://login.botframework.com/v1/.well-known/openidconfiguration.
- Reddit and Signal channels need a small worker that polls the
  upstream API every 30s and POSTs into the bearer-protected
  `/webhooks/{channel}` endpoint. The reply adapter exposes the
  poll function (`pollRedditInbox`, `pollSignalInbox`).
- LinkedIn adapter is shaped but feature-gated by env presence;
  expect to wire it when partner approval lands.
