# `@vtorn/stream-server`, WebSocket protocol

The stream server is the fan-out layer between producers (mock, StatsBomb replay, video ingest, live data) and renderer clients. It is **not** a REST API; clients connect via WebSocket and receive an ordered stream of spec messages.

If you're looking for OpenAPI: there is no JSON HTTP surface beyond `/healthz` and `/admin/status`. This doc covers the WS protocol instead.

## Connecting

```
wss://stream.tournamental.com/v1/match/<match_id>
```

Local dev: `ws://localhost:4001/v1/match/<match_id>`.

`<match_id>` matches the regex `/^[A-Za-z0-9._:-]+$/` and refers to a match the server is currently producing for. Unknown match IDs are rejected at the upgrade with HTTP 404.

Per-IP and total connection caps are enforced at upgrade-time. When exceeded, the server sends a single `x_error` message and closes with WebSocket close code `1013` (Try Again Later).

## Hello frame

The first message every client receives is a `hello`:

```json
{
  "type": "hello",
  "spec_version": "0.1.1",
  "match_id": "fifa-wc-2022-final-arg-fra",
  "server_time_ms": 1778430000000,
  "ring_size": 1024,
  "replay_window_ms": 60000
}
```

After `hello`, the client receives any in-ring history (replayed) followed by the live tail. Order is monotonic by `t` (match time, ms) within each phase.

## Spec messages

Three kinds of message flow over the stream, all defined in [`packages/spec`](../../packages/spec):

1. **`MatchInit`**, exactly one, immediately after `hello`. Static scene description: teams, kits, players, field dimensions.
2. **`StateFrame`**, many, batched into ~100ms windows. Player positions, ball position, animation tags, possession.
3. **`Event`**, discrete events: kickoff, goal, foul, card, substitution, half-time, full-time, penalty.

See [`02-spec.md`](../02-spec.md) for the canonical contract and [`packages/spec/src/index.ts`](../../packages/spec/src/index.ts) for the TypeScript types.

## Server-sent control messages

Beyond spec messages, the server may send these control frames:

| `type` | When | Action |
| --- | --- | --- |
| `hello` | At connection start | Inspect `spec_version`; reject if you can't speak it |
| `x_error` | When the server is shedding load or refusing the upgrade | Close cleanly; back off |
| `x_keepalive` | Every 30s when no other message has been sent | Reset your idle timer |

Anything not on this list is a spec message, pass it to your decoder.

## Client → server messages

The current protocol is **server-push only.** Clients do not send messages; if they do, the server ignores them. Future versions may add subscription filters or rewind requests; this is tracked in [`IDEAS.md`](../../IDEAS.md).

## Idempotency and reconnect

The ring buffer keeps the most recent `ring_size` messages (default 1024) for a `replay_window_ms` window (default 60s). If a client reconnects within the window, it gets the missed messages replayed in order. After the window, the connection starts from the live tail with a fresh `MatchInit`.

Clients must tolerate seeing `MatchInit` more than once per session.

## Admin endpoint

```
GET /admin/status
Authorization: Bearer <STREAM_ADMIN_TOKEN>
```

Returns:

```json
{
  "ok": true,
  "uptime_ms": 12345,
  "matches": [
    { "match_id": "fifa-wc-2022-final-arg-fra", "subscribers": 42, "messages_sent": 891234 }
  ]
}
```

## Performance budgets

Per [`../22-deployment-and-tunnels.md`](../22-deployment-and-tunnels.md):

- Same-continent p95 lag: < 250ms from producer → subscriber receive
- Per-IP cap: 4 concurrent subscribers (configurable via `STREAM_PER_IP_MAX`)
- Total cap: 5000 concurrent subscribers per origin

## Related

- [`05-mock-producer.md`](../05-mock-producer.md), synthetic producer for renderer dev
- [`08-cdn-distribution.md`](../08-cdn-distribution.md), Cloudflare CDN, manifest layout
- [`apps/stream-server/README.md`](../../apps/stream-server/README.md), service-level config and operational notes
