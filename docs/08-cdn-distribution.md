# 08 — CDN Distribution

> "Write once, run everywhere." The spec stream is append-only and immutable, so CDN caching is essentially free fan-out. This doc specifies the chunking strategy, URL layout, and Cloudflare configuration.

## URL layout

Every match exposes a canonical directory at the origin:

```
https://origin.example.com/streams/<match_id>/
   ├── init.json                 # MatchInit. Fetched once per client.
   ├── live.m3u8                 # Manifest pointing at active chunks.
   ├── chunk-000001.ndjson.gz    # Immutable; renames not allowed.
   ├── chunk-000002.ndjson.gz
   ├── chunk-000003.ndjson.gz
   └── ...
```

These are static files. The chunk writer in the stream server creates them; the CDN serves them.

A client's request sequence:

1. `GET /streams/<id>/init.json` (cache-forever).
2. `GET /streams/<id>/live.m3u8` (cache-1s).
3. For each chunk in the manifest: `GET /streams/<id>/chunk-NNNNNN.ndjson.gz` (cache-forever).
4. Re-fetch `live.m3u8` periodically (every chunk-duration / 2) to discover new chunks.
5. When the manifest contains an `END` marker, stop polling.

This is exactly the HLS pattern, with NDJSON instead of MPEG-TS segments. We deliberately reuse HLS's vocabulary because every CDN already knows how to handle it well.

## Chunk size

Two supported chunk durations:

- **1s chunks** — low latency (3–5s end-to-end with a 3-chunk jitter buffer), more files per match (~5,400 for a 90-min match), more requests per client.
- **5s chunks** — higher latency (15–20s end-to-end), fewer files (~1,080), better cache hit ratio per file.

The chunk writer can produce both simultaneously and the manifest exposes both as separate quality levels. Renderers default to 1s for live, 5s for replay.

A "chunk" here is just a gzipped NDJSON file containing every state frame and event whose `t` falls within `[chunk_start, chunk_end)`. No re-encoding needed; just buffer a second's worth of messages and flush.

## Manifest (`live.m3u8`)

Adapted from HLS. Plain text, easy to parse:

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:1
#EXT-X-MEDIA-SEQUENCE:1240
#EXT-X-MAP:URI="init.json"
#EXTINF:1.000,
chunk-001240.ndjson.gz
#EXTINF:1.000,
chunk-001241.ndjson.gz
#EXTINF:1.000,
chunk-001242.ndjson.gz
```

Append `#EXT-X-ENDLIST` when the match ends. Sliding window: keep ~30 chunks in the live manifest; older chunks remain on disk and CDN for replay (separate `archive.m3u8`).

## Cache headers

This is the whole game.

```
init.json
  Cache-Control: public, max-age=31536000, immutable
  Content-Type: application/json

chunk-NNNNNN.ndjson.gz
  Cache-Control: public, max-age=31536000, immutable
  Content-Encoding: gzip
  Content-Type: application/x-ndjson

live.m3u8
  Cache-Control: public, max-age=1, stale-while-revalidate=2
  Content-Type: application/vnd.apple.mpegurl
```

Chunks and `init.json` are content-addressed by URL (the chunk index never reuses a number, the init never changes), so they can be cached forever. Only the manifest is short-lived, because new chunk references appear in it.

## Cloudflare configuration

For the `streams.example.com` hostname (CNAME'd to origin):

```
# Page Rule / Cache Rule
URL match: streams.example.com/streams/*/init.json
URL match: streams.example.com/streams/*/chunk-*.ndjson.gz
  Cache Level: Cache Everything
  Edge Cache TTL: 1 year
  Browser Cache TTL: respect origin

URL match: streams.example.com/streams/*/live.m3u8
  Cache Level: Cache Everything
  Edge Cache TTL: 1 second
  Browser Cache TTL: 1 second
```

Enable **Tiered Caching** so far-edge PoPs warm via a regional tier rather than going all the way to origin. With ~250 edges and tiered caching, a 1M-concurrent-viewer match generates roughly:

- 1 origin fetch per chunk per regional tier (~12 fetches per chunk worldwide).
- 1 fetch per edge per chunk from the regional tier (cheap, all in-network).
- ~12 origin requests/sec at peak for a 1s-chunk live stream. Fits a single t3.small with bandwidth to spare.

## Compression

ndjson compresses extremely well — most values in state frames are repetitive. Empirically a 1s state-only chunk at 30Hz with 22 players is ~30KB raw, ~6KB gzipped. A whole 90-min match is ~30MB on disk pre-compression, ~6MB compressed. CDN bandwidth at 1M viewers for a full match is roughly 6TB. Cloudflare Free tier handles that; a Pro plan eliminates any conceivable concern.

Brotli at the CDN edge (CF supports it) cuts another ~15%. Worth enabling.

## Authentication

For a fully open project there's none — anyone with the URL can fetch the stream. If the operator wants paid tiers later:

- **Signed URLs** (Cloudflare's signed-URL feature, or signed cookies). Origin issues short-lived tokens; CDN validates without calling origin.
- **Worker auth** (Cloudflare Workers in front of cache). Costs a few µs per request; negligible at this scale.

Neither is needed for v0.1.

## Replay and seek

Replay is the same wire format. The client requests `archive.m3u8` instead of `live.m3u8`, which lists every chunk for the completed match. The renderer can seek by:

1. Binary-search the `archive.m3u8` for the chunk containing the target `t_ms`.
2. Fetch all chunks from `chunk-0` (for state continuity — the renderer needs `match.init` and at least one carrier resolution) up through the target chunk.

For very large seeks, the stream server can also publish `keyframes.json` — a sparse index of "complete world snapshots" written every 30s, so the seeker only needs to fetch one keyframe + the chunks since it. Optional optimisation; not required for v0.1.

## Why this is durable

The architecture has zero per-viewer state on the hot path. Origin write rate is constant in viewer count. CDN cost scales linearly in viewer count but at fractions of a cent per GB. The same files serve a 10-viewer dev test and a 10-million-viewer World Cup final without code changes — only the cache TTL on `live.m3u8` is a tuning knob, and not by much.

The same property makes failover trivial: any second origin pointed at the same `/streams/` directory (NFS / S3 / synced disk) is fully interchangeable. Stream servers are stateless apart from the chunk files themselves.
