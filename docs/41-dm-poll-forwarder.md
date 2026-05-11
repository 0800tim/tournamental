# 41, DM Poll-Forwarder

> Polling worker that adapts the three "no native webhook" platforms (Reddit, Mastodon, Signal) into the [`apps/dm-otp`](../apps/dm-otp/) ingest contract so all 16 DM-OTP login channels work the same on the receiving end.

## Why this exists

`apps/dm-otp` accepts inbound DM events via per-platform HTTP webhooks and replies with a 6-digit code. Thirteen of the sixteen login channels (Telegram, WhatsApp, Messenger, Instagram, Discord, X, Threads, Slack, Line, Viber, Teams, LinkedIn, Email) push events at us, the platform calls our webhook when a user DMs the bot.

The three exceptions:

| Platform | Why no webhook |
| --- | --- |
| Reddit | The public API only exposes the `/message/inbox` listing; no push hook is offered for personal-use script apps. |
| Mastodon | Uses a streaming API or polling of `/api/v1/conversations`. There is no general-purpose HMAC-signed inbound webhook. |
| Signal | Self-hosted via signal-cli REST proxy; the proxy exposes `GET /v1/receive/<number>` rather than pushing. |

`apps/dm-poll-forwarder` runs a small worker per channel, polls the platform's API on a per-channel interval, and re-shapes each new DM into the body the matching `dm-otp` webhook expects. From `dm-otp`'s perspective the three channels look identical to the other thirteen.

## Architecture

```
+----------------+        +---------------------+         +-----------+
| Reddit inbox   | poll  -> reddit-poller       \         |           |
| Mastodon convs | poll  -> mastodon-poller     -> Forwarder -> dm-otp/v1/auth/dm-otp/webhooks/{reddit,mastodon,signal}
| signal-cli     | poll  -> signal-poller       /         |           |
+----------------+        +---------------------+         +-----------+
                              |                  \
                              v                   v
                          cursors.jsonl      forward-failed.jsonl
```

- **Pollers** implement a single `poll(previousCursor) -> { messages, cursor }` interface (see [`src/pollers/types.ts`](../apps/dm-poll-forwarder/src/pollers/types.ts)).
- **Cursor store** (`data/cursors.jsonl`) is append-only with latest-line-wins semantics. Compacts when it crosses 1 MiB. One short string per channel.
- **Forwarder** retries with exponential backoff (200 ms → 400 ms → 800 ms by default) on 5xx/429/network errors. Permanent 4xx is dead-lettered immediately. Exhausted retries land in `data/forward-failed.jsonl`.
- **Scheduler** runs each channel on its own interval with concurrency 1 per channel. If a `forward()` fails mid-cycle the cursor is *not* advanced past the failed message, the next poll retries the same items, so duplicates are bounded by the dm-otp service's own per-(channel, externalId) idempotency.

## Per-platform notes

### Reddit

- API: `GET https://oauth.reddit.com/message/inbox.json?limit=25` with `bearer <token>` and a clear `User-Agent`.
- Auth: Reddit script-app OAuth password grant cached in memory; on `401` the token is dropped and re-fetched on the next cycle.
- Cursor: Reddit's per-thing `name` (e.g. `t4_abc123`). We compare with `>` so newer items always advance.
- Filtering: only entries with `was_comment === false` (DMs, not comment replies) and a present `author` + `body` are forwarded.
- We **do not** mark messages as read so the bot account's UI keeps a human-readable audit trail.

### Mastodon

- API: `GET https://<host>/api/v1/conversations?since_id=<lastId>&limit=20` with `Authorization: Bearer <token>`.
- Multi-instance: configured via `MASTODON_INSTANCES=host=token;host=token`. Each instance carries its own access token. The cursor is a JSON object `{ "<host>": "<lastConvId>", ... }` so per-instance progress is independent.
- Filtering: only `unread === true` conversations whose `last_status.visibility === 'direct'` are forwarded. Non-direct posts (e.g. a public mention) cannot trigger an OTP.
- Body decoding: `last_status.content` is HTML; we strip tags and decode the small set of HTML entities a 6-digit OTP message body could contain. We do not pull in a full HTML parser.

### Signal

- API: `GET <SIGNAL_API_URL>/v1/receive/<botNumber>` against a self-hosted [signal-cli REST API](https://github.com/bbernhard/signal-cli-rest-api).
- Cursor: composite `<paddedTimestamp>:<sourceUuid>` so two envelopes at the same ms still order deterministically.
- Filtering: envelopes without a `dataMessage.message` (delivery receipts, typing indicators, story acks) are skipped.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/healthz` |, | Liveness. |
| `GET` | `/v1/version` |, | Service + channel list. |
| `GET` | `/v1/status` |, | Per-channel `lastPollAt`, `cursor`, `lagMs`, `lastError`. |
| `POST` | `/v1/admin/pause/:channel` | `x-poll-admin` | Stops scheduling cycles for that channel until resumed. |
| `POST` | `/v1/admin/resume/:channel` | `x-poll-admin` | Re-enables a paused channel. |
| `POST` | `/v1/admin/replay-failed` | `x-poll-admin` | Drains `forward-failed.jsonl`, retries each entry, keeps the still-failing ones. |

The admin token must be **at least 32 characters in production**. In development a fixed insecure default is used so smoke tests work without env wiring.

## Environment variables

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `POLL_FORWARDER_PORT` | no | `3404` | Listen port. |
| `POLL_FORWARDER_BIND` | no | `0.0.0.0` | Listen address. |
| `POLL_BACKEND` | no | `mock` | `mock` or `real`. |
| `DM_OTP_BASE_URL` | yes (real) | `http://127.0.0.1:3331` | dm-otp base URL. |
| `POLL_FORWARDER_BEARER` | yes (real) | empty | Shared with `dm-otp` (`*_POLLER_BEARER` / `MASTODON_INBOUND_BEARER`). |
| `POLL_ADMIN_TOKEN` | yes (prod) | dev default | Admin gate. ≥ 32 chars in prod. |
| `POLL_INTERVAL_REDDIT_MS` | no | `30000` | Reddit poll interval. |
| `POLL_INTERVAL_MASTODON_MS` | no | `20000` | Mastodon poll interval. |
| `POLL_INTERVAL_SIGNAL_MS` | no | `15000` | Signal poll interval. |
| `POLL_DATA_DIR` | no | `./data` | Where cursors and dead-letter files live. |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USERNAME` / `REDDIT_PASSWORD` / `REDDIT_USER_AGENT` | yes (real) |, | Reddit script-app credentials. |
| `MASTODON_INSTANCES` | yes (real) |, | `host=token;host=token`. |
| `SIGNAL_API_URL` | yes (real) |, | signal-cli REST URL. |
| `SIGNAL_BOT_NUMBER` | yes (real) |, | Bot's E.164 number. |
| `POLL_MOCK_SEED` | no | `false` | When mock backend is on, pre-load one fixture per channel. |

## Mock vs real backend

- `POLL_BACKEND=mock` (default) wires three `MockPoller` instances. Operators can boot the worker locally against a dm-otp dev server without touching any third-party APIs. With `POLL_MOCK_SEED=true` each channel has one fixture so a single `runOnce` produces a real forward.
- `POLL_BACKEND=real` wires the live pollers. Each platform poller is independently disabled if its env vars are absent, the worker will still boot and `/v1/status` will report the channel as `enabled: false`.

## Admin runbook

- **Pause a noisy channel mid-incident**:
  `curl -X POST -H "x-poll-admin: <TOKEN>" https://<host>/v1/admin/pause/reddit`
- **Resume**: same URL with `resume`.
- **Replay dead-lettered messages after a dm-otp outage**:
  `curl -X POST -H "x-poll-admin: <TOKEN>" https://<host>/v1/admin/replay-failed`
  Response: `{ "replayed": N, "failed": M, "remaining": M }`. Anything that still fails stays in the file for the next replay.
- **Inspect cursors**: `tail -n 20 data/cursors.jsonl`, last line per channel is current.
- **Inspect dead letters**: `cat data/forward-failed.jsonl`, JSONL, one entry per line.

## Deployment

- Docker / PM2 process listening on `:3404` per [`docs/22-deployment-and-tunnels.md`](22-deployment-and-tunnels.md). Tunnel ingress: a private host like `vtorn-poll.aiva.nz` (admin endpoints are bearer-protected; do not expose `/v1/admin/*` to the public internet without IP allow-listing in addition).
- Volume-mount `data/` so cursors survive restarts.
- Liveness: `/healthz`. Readiness: `/v1/status` returning HTTP 200 with all enabled channels reporting `lastPollOk !== false` (or no `lastPollAt` yet on a fresh boot).
- Graceful shutdown: SIGTERM stops the scheduler timers and waits for any in-flight cycle before closing the HTTP server.

## Testing

```bash
pnpm --filter @vtorn/dm-poll-forwarder typecheck
pnpm --filter @vtorn/dm-poll-forwarder test
```

44 unit + integration tests cover cursor advancement, retry-with-backoff, dead-letter queue, admin pause/resume gating, and an end-to-end round-trip via a real loopback HTTP server.
