# @vtorn/stream-server

> Live-stream fan-out for the VTorn match stream. Sits between one
> producer (StatsBomb-replay, mock-producer, future live-event ingester)
> and many subscribers. See [docs/03-architecture.md](../../docs/03-architecture.md)
> for the wider stream-tier design.

## What it does

The `apps/statsbomb-replay/` producer emits the AR-FR final on
`ws://localhost:4001`. That's fine for one viewer — it's a single
WebSocket and any connected client gets every frame. It is **not** fine
for fan-out: a slow client back-pressures the producer, the producer
serialises sends across all clients, and there's no rate or connection
limiting.

This service fixes that. It:

1. **Subscribes** to one (or more) upstream producers as a normal WS
   client.
2. **Rings** the last `STREAM_RING_SECONDS` (default 60) of frames per
   `match_id` in memory. New subscribers receive the cached `MatchInit`
   plus the recent ring contents on connect.
3. **Fans out** every incoming message to all subscribers of that
   match. Each subscriber has its own bounded outbound queue. If a
   subscriber falls behind, frames are dropped *for that subscriber
   only* — never for others, never for the producer.
4. **Rate-limits** subscribers per IP and globally.
5. **Exposes** small admin REST endpoints for ops.

The producer never blocks on a slow subscriber. That is the whole point
of the service.

## Quick start

```bash
# In one terminal — run the upstream AR-FR replay producer
cd apps/statsbomb-replay
uv run python -m statsbomb_replay.replay \
  --statsbomb-data ./statsbomb-open-data \
  --time-scale 10 \
  --out ws --port 4001

# In another — run the fan-out server
cd apps/stream-server
cp .env.example .env       # fine as-is for dev
pnpm dev

# In a third — connect as a viewer
wscat -c ws://localhost:4002/v1/match/fifa-wc-2022-final-arg-fra-2022-12-18
```

Or, with curl, for the admin and health surfaces:

```bash
# Liveness — always 200 if the service is up.
curl -s http://localhost:4002/healthz | jq

# Service descriptor.
curl -s http://localhost:4002/ | jq

# Admin status — set STREAM_ADMIN_TOKEN first; bearer is required.
curl -sH "Authorization: Bearer $STREAM_ADMIN_TOKEN" \
  http://localhost:4002/admin/status | jq
```

## Protocol

### Subscribing — `ws://host:4002/v1/match/:match_id`

`match_id` is the same string the producer emits in
`MatchInit.match_id`. For the AR-FR demo:
`fifa-wc-2022-final-arg-fra-2022-12-18`.

On a successful upgrade, the server sends one envelope, then primes the
client from the ring, then forwards live frames as they arrive:

1. **Hello** — a non-spec envelope so renderers can detect the
   server. Type-tag is prefixed with `x_` so well-behaved
   spec-consumers ignore it. Looks like:

   ```json
   {
     "type": "x_hello",
     "service": "@vtorn/stream-server",
     "version": "0.0.1",
     "spec_version": "0.1.1",
     "match_id": "fifa-wc-2022-final-arg-fra-2022-12-18",
     "ring": { "match_id": "...", "has_init": true, "frames": 1234, ... }
   }
   ```

2. **Cached `match.init`** — the static scene description. Always
   delivered before any frames.
3. **Buffered ring frames** — every state + event that's still in the
   `STREAM_RING_SECONDS` window, oldest first. A late joiner gets
   immediately rich context.
4. **Live frames** — every new message the producer emits, forwarded
   in arrival order.

All payloads are NDJSON-style: one JSON object per WebSocket message,
no framing on top.

### Rate limit / failure modes

- Path doesn't match `/v1/match/[A-Za-z0-9._:-]+` → HTTP 404 on the
  upgrade.
- Per-IP cap exceeded (default 100) → upgrade succeeds, server
  immediately sends `{"type":"x_error","error":"per_ip"}` and closes
  with code 1013.
- Total cap exceeded (default 5000) → same shape, `error: "total"`.
- Subscriber's outbound queue is full for `STREAM_SUB_STALL_MS`
  (default 5000ms) → server closes with code 1011.

### Admin REST

`GET /admin/status` requires header `Authorization: Bearer
$STREAM_ADMIN_TOKEN`. If `STREAM_ADMIN_TOKEN` is empty, the route
returns 503 (admin disabled). Sample response:

```json
{
  "service": "@vtorn/stream-server",
  "version": "0.0.1",
  "spec_version": "0.1.1",
  "uptime_ms": 1234567,
  "producers": [
    {
      "url": "ws://localhost:4001",
      "state": "open",
      "frames_in": 18432,
      "parse_errors": 0,
      "reconnects": 0,
      "last_frame_at": 1715000000000,
      "current_match_id": "fifa-wc-2022-final-arg-fra-2022-12-18"
    }
  ],
  "subscribers": 42,
  "matches": [
    {
      "match_id": "fifa-wc-2022-final-arg-fra-2022-12-18",
      "subscribers": 42,
      "ring": { "frames": 1800, "span_ms": 60000, "age_ms": 33, ... }
    }
  ],
  "frame_rate": 30.1,
  "ring_seconds": 60,
  "dropped_frames": 0,
  "limits": { "per_ip": 100, "total": 5000 }
}
```

`GET /healthz` is bearer-free liveness. Returns 200 when at least one
configured producer is `open` (or 200 when no producers are configured
at all, useful for tests). 503 otherwise.

## Configuration

All config via environment variables. See `.env.example` for the full
list with defaults. The interesting ones:

| Var                          | Default                | What                                                              |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `STREAM_PORT`                | `4002`                 | Listen port for HTTP + WS.                                        |
| `STREAM_BIND`                | `0.0.0.0`              | Bind address.                                                     |
| `STREAM_PRODUCER_URLS`       | `ws://localhost:4001`  | Comma-separated upstream WS producers.                            |
| `STREAM_RING_SECONDS`        | `60`                   | Ring window size per match.                                       |
| `STREAM_ADMIN_TOKEN`         | (empty)                | Required for `/admin/*`. Empty disables admin entirely.           |
| `STREAM_MAX_CONNS_PER_IP`    | `100`                  | Per-IP subscriber cap.                                            |
| `STREAM_MAX_CONNS_TOTAL`     | `5000`                 | Total subscriber cap (single-node).                               |
| `STREAM_SUB_QUEUE_MAX`       | `120`                  | Bounded per-subscriber outbound queue (messages).                 |
| `STREAM_SUB_STALL_MS`        | `5000`                 | Close a subscriber whose queue stays full this long.              |
| `STREAM_PRODUCER_BACKOFF_MIN_MS` | `500`              | Initial reconnect backoff to upstream producer.                   |
| `STREAM_PRODUCER_BACKOFF_MAX_MS` | `8000`             | Max reconnect backoff (with 25% jitter).                          |
| `LOG_LEVEL`                  | `info`                 | Pino level.                                                       |
| `LOG_PRETTY`                 | `0`                    | Set `1` for `pino-pretty` in dev.                                 |

## Capacity and bandwidth

A 30Hz state stream with 22 players + ball + occasional events is
roughly 2-4 KB per JSON-encoded message. At 30Hz that's about
`30 * 3KB = 90 KB/s` per subscriber, i.e. **~720 kbps per subscriber**
on the wire (uncompressed). A single node trivially serves a few
hundred subscribers on a gigabit link; the docs/22 budget caps a single
node at 5000 connections to leave headroom and protect the GC.

For >5000 concurrent viewers, the recommended path is **CDN fan-out**
via the chunk-file writer (see `docs/08-cdn-distribution.md`). The
chunk writer is intentionally a separate concern; it can sit beside
this service or in its own process. CDN-served chunks scale to
millions of viewers at the cost of 1-10s extra latency.

## Multi-node future path

This service is single-node by design. To scale horizontally:

- Stand up N stream-server nodes behind a load balancer that hashes by
  `match_id` so subscribers for the same match end up on the same
  node. Each node subscribes to the upstream producer independently.
- Or, introduce a Redis pubsub between producers and stream-servers so
  the producer publishes once and every node receives the fan-out
  channel. (Documented but not yet implemented; see
  `IDEAS.md`.)

## Development

```bash
pnpm --filter @vtorn/stream-server dev          # tsx watch src/server.ts
pnpm --filter @vtorn/stream-server typecheck    # tsc --noEmit
pnpm --filter @vtorn/stream-server test         # vitest (unit + e2e + bench)
pnpm --filter @vtorn/stream-server build        # emit dist/
pnpm --filter @vtorn/stream-server start        # run the built service
```

The synthetic fan-out benchmark in `tests/bench.test.ts` measures
loopback delivery latency for N=200 subscribers at 30Hz over 5
seconds. Sample results from this dev box:

```
bench: subs=200 frames=150 samples=30000 p50=10.7ms p99=23.0ms drops=0
```

(p99 < 25ms loopback, zero drops at 200 subscribers — well within the
docs/22 250ms-WS-lag budget.)

## Testing manually

```bash
# 1. Start the server (mock producer not needed; we'll fake one).
STREAM_PRODUCER_URLS= STREAM_ADMIN_TOKEN=tok pnpm dev

# 2. In another terminal, start a quick local producer:
cd ../mock-producer && pnpm start -- --seed=42 --out=ws --port=4001
# (then restart the stream-server with STREAM_PRODUCER_URLS=ws://localhost:4001)

# 3. wscat into a match (use whatever match_id mock-producer emitted in
#    its match.init):
wscat -c ws://localhost:4002/v1/match/<match_id>
```
