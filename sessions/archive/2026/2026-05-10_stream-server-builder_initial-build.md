# 2026-05-10 — stream-server-builder — initial-build

**Status**: done

**PR**: opened against `main` from `feat/stream-server`.

## Outcome

- 46 tests passing across 6 files (`ring`, `producer`, `hub`, `config`,
  `server` end-to-end, `bench`).
- Synthetic loopback fan-out benchmark (N=200 subscribers, 5s @ 30Hz):
  `subs=200 frames=150 samples=30000 p50=9.8ms p99=23.6ms drops=0`.
  Comfortably under the docs/22 250ms WS-lag p95 budget.
- `pnpm --filter @vtorn/stream-server typecheck` clean.
- `pnpm --filter @vtorn/stream-server build` produces `dist/`.
- `docs/22-deployment-and-tunnels.md` updated with the new :4002 row +
  `stream-fanout.tournamental.com` ↔ `stream.vtourn.com`.
- README documents the protocol, hello envelope, admin REST shape,
  capacity estimate, and multi-node future path.

## Goal

Land `apps/stream-server/` — a single-node Node 20+ TypeScript service that
sits between one or more upstream WebSocket producers (e.g.
`apps/statsbomb-replay/` on `:4001`) and many downstream subscribers. It
maintains an in-memory ring of the last N seconds of frames, fans out to
many WS clients on `:4002`, drops on slow subscribers (back-pressure
isolation), and exposes a small admin REST surface for ops.

This is the agent C / docs/03 / docs/08 "stream server (origin)" piece —
the thing that lets a producer ever serve more than one viewer.

## Reading

- `CLAUDE.md` — agent ops protocol, performance + caching standing rule.
- `docs/03-architecture.md` — origin server responsibilities (fan-in,
  validation, optional persistence, live socket).
- `docs/08-cdn-distribution.md` — CDN-side companion; chunking is out of
  scope for this service for now (file-write path lives elsewhere); we
  focus on live socket fan-out.
- `docs/22-deployment-and-tunnels.md` — port table; we add :4002 +
  `stream-fanout.tournamental.com`.
- `apps/statsbomb-replay/README.md` — upstream producer shape.
- `apps/mock-producer/src/emitter.ts` — `WebSocketEmitter` for protocol
  shape (init-on-connect + paced messages + 40-line backlog).
- `apps/api/src/server.ts` — Fastify conventions in this repo.
- `packages/spec/src/index.ts` — `Message` shape; producer emits
  `MatchInit | StateFrame | EventMessage`.

## Plan

1. Scaffold `apps/stream-server/` with `package.json` (`@vtorn/stream-server`),
   `tsconfig.json`, `vitest.config.ts`, `.env.example`, `README.md`.
2. Implement a `RingBuffer<Message>` keyed by `match_id`, sized by
   `STREAM_RING_SECONDS` (default 60). Stores the latest `MatchInit` plus
   a deque of `state` + `event.*` frames; eviction is by `t` against the
   newest seen frame.
3. Implement a `ProducerClient` that opens a WS to a configured upstream
   URL, receives newline-delimited JSON frames, dispatches them to the
   ring, and reconnects with exponential backoff on drop. Per-producer
   metrics: connected, frames in, last frame age.
4. Implement `SubscriberHub` — accepts new WS subscribers per
   `match_id`, sends the cached `MatchInit` and a small "hello" summary
   on connect, then forwards live frames. Each subscriber has a bounded
   send queue; if it fills, frames are dropped (counter incremented) and
   the connection is closed when the queue stays full for too long.
   Never blocks the producer.
5. Wire Fastify on `:4002` with `@fastify/websocket`. Routes:
   - `GET /v1/match/:match_id` (WS upgrade) — subscribe.
   - `GET /admin/status` — bearer-protected ops snapshot.
   - `GET /healthz` — liveness.
6. Rate limits: per-IP and total connection caps. Bandwidth + scaling
   notes in README.
7. Vitest suite (target ≥25 tests):
   - Ring eviction (t-based windowing).
   - Ring keeps init separate, replays on subscribe.
   - Fan-out: many subscribers receive every frame.
   - Slow-subscriber drop without blocking producer.
   - Admin auth: 401 without bearer, 200 with.
   - Bad WS handshake: unknown match → 404; bad path → close.
   - Reconnect on producer drop (kill upstream, verify backoff +
     reconnect).
   - Healthz reflects producer + subscriber state.
   - Concurrency benchmark: N=200 subscribers, measure delivery latency
     p50/p99 over a synthetic 10s burst at 30Hz.
8. Update `docs/22-deployment-and-tunnels.md` — add port 4002 row +
   suggested tunnel `stream-fanout.tournamental.com`.
9. Sign-off + PR per CLAUDE.md.

## Decisions

- **Bring-your-own-multi-node later.** Single-node only in this PR — no
  Redis pubsub, no gRPC. Documented as a future path in README. Keeps
  the scope tight and matches the "ship the AR-FR demo first" rule.
- **Match-keyed ring rather than global.** A producer URL maps to one
  `match_id` (extracted from `MatchInit.match_id`). Different upstream
  producers with different `match_id`s get separate rings. Simplifies
  fan-out routing.
- **Bounded queue per subscriber, not per connection.** Default queue =
  120 messages (~4s at 30Hz). When full, frames are dropped from the
  *front* (oldest) so the subscriber catches up to head; the
  `dropped_frames` counter increments. If the queue is full for >5s we
  close the connection — they're hopelessly behind.
- **Backoff for producer reconnect** uses 500ms → 8s with jitter. Worst
  case the renderer freezes for 8s; in practice <1s on a localhost dev
  setup. Same producer URL is treated as one slot; replacing producers
  while running is a future feature.
- **Admin token via env**, never hardcoded. Empty token disables admin
  surface entirely (returns 503) — safer default than "all access".
- **Use `ws` directly under Fastify** rather than `@fastify/websocket`
  to keep the API consistent with `apps/mock-producer` and avoid
  pulling in a heavier dependency stack. Fastify still handles HTTP
  routes; we attach a `WebSocketServer` to its `server.server` object.

## Out of scope (parked in IDEAS.md mentally)

- Chunk-file writer (`init.json` + `chunk-NNNN.ndjson.gz` + `live.m3u8`)
  — that's the CDN-prep piece, lives in a separate PR/agent.
- Postgres persistence — optional per docs/03 and not on the AR-FR
  critical path.
- Multi-node fan-out via Redis pubsub — single-node first.
- Producer authentication — not in the v0.1 scope; the upstream is on
  the same private network in dev.

## Acceptance

- `pnpm lint && pnpm typecheck && pnpm test` clean from repo root.
- `pnpm --filter @vtorn/stream-server test` clean (≥25 tests).
- `.env.example` complete with all six configurable env vars.
- README documents protocol, the curl/wscat walkthrough, capacity
  estimate, and the multi-node future path.
- `docs/22-deployment-and-tunnels.md` updated.

## Next steps (if rolled to a follow-up)

- Add the `@fastify/websocket` migration if the team prefers it.
- Add the chunk-file writer alongside fan-out.
- Add a `/v1/match/:match_id/replay?since=t` HTTP endpoint that streams
  the ring as NDJSON for late joiners that don't want a WS.
