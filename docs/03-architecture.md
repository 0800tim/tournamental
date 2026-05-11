# 03, System Architecture

> End-to-end design from "raw input" (a video feed, a tracking JSON, a CLI) through "rendered 3D world in the browser." The unifying contract is the [JSON spec](02-spec.md); everything below the spec is replaceable.

## Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                            PRODUCERS                                │
│                                                                     │
│  ┌───────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────┐  │
│  │ Mock gen  │  │ Video → AI    │  │ Official feed │  │ STT-only │  │
│  │ (Node TS) │  │ (Python: CV + │  │ (TS adapter)  │  │ (Whisper │  │
│  │           │  │  Whisper +    │  │               │  │  + LLM)  │  │
│  │           │  │  vision LLM)  │  │               │  │          │  │
│  └─────┬─────┘  └───────┬───────┘  └───────┬───────┘  └────┬─────┘  │
│        └────────────────┴───────────┬──────┴────────────────┘       │
└──────────────────────────────────────┼──────────────────────────────┘
                                       │  spec-conformant JSON stream
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         STREAM SERVER (origin)                      │
│                                                                     │
│   ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│   │ WebSocket /SSE  │  │ Chunk writer     │  │ Postgres         │   │
│   │ live fan-in     │─▶│ NDJSON → 1s/5s   │  │ matches, events, │   │
│   │ from producers  │  │ files on disk    │  │ replay index     │   │
│   └─────────────────┘  └────────┬─────────┘  └──────────────────┘   │
│                                  │ writes to                        │
│                                  ▼                                  │
│                          ┌─────────────────┐                        │
│                          │ /streams/<m>/   │                        │
│                          │   init.json     │                        │
│                          │   chunk-0001.   │                        │
│                          │     ndjson.gz   │                        │
│                          │   chunk-0002... │                        │
│                          │   live.m3u8     │                        │
│                          └────────┬────────┘                        │
└───────────────────────────────────┼─────────────────────────────────┘
                                    │ HTTP, immutable URLs
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE CDN (cache layer)                  │
│                                                                     │
│  Edge nodes worldwide. Each chunk fetched once per edge per match.  │
│  1M viewers ≈ 200 cache misses to origin (one per Cloudflare PoP).  │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Default      │  │ Forked world │  │ Tactical     │  │ Discord  │ │
│  │ Next.js+R3F  │  │ (Roblox-     │  │ heatmap      │  │ overlay  │ │
│  │ renderer     │  │ flavoured)   │  │              │  │          │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## The four producer types

All producers emit the *same* spec-conformant stream. They differ only in what they consume.

**Mock producer** (`apps/mock-producer/`, Node TS). Pure synthetic match. No external inputs. Useful for renderer development, CI tests, and the "no live game right now" demo. See [docs/05-mock-producer.md](05-mock-producer.md).

**Video → AI producer** (`apps/video-ingest/`, Python). Watches a video stream (file, RTMP, HLS, YouTube) and produces a stream from it. Pipeline: ffmpeg samples frames at 1–5 fps + extracts audio; Whisper transcribes audio in 1–3 second windows; a vision LLM (Claude or GPT-4o) describes each sampled frame in structured JSON; an event-extractor LLM merges the transcript and frame descriptions into spec events at roughly 1 keyframe per second of game time. Lossy and approximate, but cheap and works on any source. See [docs/06-video-ingest.md](06-video-ingest.md).

**Official feed adapter** (`apps/feed-adapter/`, Node TS). Translates a licensed/scraped tracking feed (Genius Sports, Stats Perform, Second Spectrum, NFL Next Gen, RFID jersey systems) into the spec. The bulk of the work is mapping their schema to ours and resampling their tick rate. The ethics and legality of acquiring such a feed are entirely the operator's problem; the adapter just translates.

**Commentary-only producer** (`apps/stt-producer/`, Python). When no positional data is available, transcribe broadcast commentary with Whisper, run an LLM that infers events ("Smith scores from twelve yards") and *plausible* positions. Output is dramatically lower fidelity, players teleport between events, but is enough for stylized recap-style worlds where strict spatial accuracy doesn't matter.

Multiple producers MAY run for the same `match_id`. The stream server can either pick one as canonical, or merge (e.g. positions from the official feed, commentary from the STT producer).

## Stream server (origin)

A single Node/TypeScript service. Responsibilities:

- **Fan-in.** Accept WebSocket / SSE / authenticated HTTP POST from any number of producers. One producer at a time is "primary" per match; others are accepted as supplements (e.g. commentary side-stream) or hot-spares.
- **Validation.** Reject messages that don't match the spec types. Log producer-version mismatches loudly.
- **Persistence.** Write every message to Postgres for replay and analytics. The DB is *not* on the hot path for clients; it's for offline queries.
- **Chunking.** Roll the live NDJSON stream into immutable files on disk: `init.json` (the MatchInit) and `chunk-NNNN.ndjson.gz` (a fixed-duration window of frames + events, default 1s; 5s also supported). Update an `live.m3u8`-style manifest pointing at the latest chunks.
- **Live socket.** Expose a passthrough WebSocket / SSE for clients that want sub-second latency and don't care about CDN economics.

Why both chunk files *and* a live socket? Two audiences. The free-tier audience reads from CDN and is happy with 5–10s latency for "free at scale." The paying / dev / showcase audience hits the live socket directly for sub-second updates.

## Clients

A client is anything that consumes the spec. It picks one of two transports:

- **CDN replay** for chunked playback, fetches `init.json`, then chunks in order, with a small jitter buffer. Latency 1–10s depending on chunk size. Effectively free at any scale.
- **Live socket** for live playback, opens a WebSocket / SSE to origin. Sub-second latency. Origin-bound, costs more, doesn't scale linearly.

The default Next.js + R3F renderer supports both, with a config flag. Forked worlds inherit this for free if they use the published client SDK (`packages/spec-client/`).

## Persistence

Two distinct persistence regimes, by tier:

- **Match stream tier** (this doc, agents A–E). Optional minimal Postgres for *offline* replay and analytics; never on the live read path. Live playback comes from the chunk files on disk plus the live WebSocket. If you don't want Postgres at all, omit it, long-term archive can be JSONL on disk and queried with DuckDB. The schema below is offered, not required.
- **Gamification tier** (predictions, leaderboards, badges, pools, see [doc 12](12-odds-and-predictions.md)). **No SQL.** Redis is the write authority; a snapshotter flushes JSON to `/v1/static/...` every 5–60s; Cloudflare CDN serves the JSON to clients. This regime is described in detail in doc 12; it shares no infrastructure with the match stream tier other than Cloudflare in front and the spec event subscription that feeds settlement.

### Optional match stream Postgres schema

```sql
CREATE TABLE matches (
  match_id      TEXT PRIMARY KEY,
  sport         TEXT NOT NULL,
  init_json     JSONB NOT NULL,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,
  producer      TEXT,
  spec_version  TEXT NOT NULL
);

CREATE TABLE messages (
  match_id   TEXT NOT NULL REFERENCES matches(match_id),
  t_ms       BIGINT NOT NULL,
  kind       TEXT NOT NULL,            -- 'state' | 'event.<x>'
  payload    JSONB NOT NULL,
  PRIMARY KEY (match_id, t_ms, kind)
);
CREATE INDEX messages_match_t ON messages(match_id, t_ms);
CREATE INDEX messages_match_kind ON messages(match_id, kind) WHERE kind LIKE 'event.%';

CREATE TABLE chunks (
  match_id    TEXT NOT NULL REFERENCES matches(match_id),
  chunk_index INT NOT NULL,
  start_t_ms  BIGINT NOT NULL,
  end_t_ms    BIGINT NOT NULL,
  uri         TEXT NOT NULL,           -- /streams/<m>/chunk-NNNN.ndjson.gz
  byte_size   INT NOT NULL,
  PRIMARY KEY (match_id, chunk_index)
);
```

## Failure modes and reliability

The infra Tim is targeting (gigabit fibre + Starlink failover, lithium battery backup) means physical redundancy is solid; the software needs to match.

- **Producer crash.** Origin keeps serving the last successfully-emitted chunk. Renderer freezes its scene at the last known state. A watchdog can hot-spare to a backup producer.
- **Origin crash.** CDN keeps serving previously-cached chunks indefinitely. New chunks stop appearing until origin is back. Renderer should display a "feed lost" indicator after N missed chunks.
- **Network partition between producer and origin.** Producer should buffer locally (bounded ring buffer) and replay on reconnect. Origin must dedupe by `(match_id, t_ms, kind)`, that's why it's the primary key on `messages`.
- **Cloudflare outage.** Live-socket clients keep working (origin-direct). CDN clients reconnect when CF returns. Consider a secondary CDN (Bunny.net, Fastly) for true vendor redundancy if it ever matters.

## Why this architecture is the right shape

The spec is a one-way append-only stream. That property is what makes everything cheap: chunks are immutable, so they cache forever; new viewers replay from `init.json` + chunks; the stream is trivially fan-out-able to any number of clients without any per-client server work. CDN economics do the heavy lifting. The only thing that scales with viewer count is bandwidth, and Cloudflare's free tier covers a *lot* of hobby-project bandwidth.

Detail on chunking, cache headers, and edge config in [docs/08-cdn-distribution.md](08-cdn-distribution.md).
