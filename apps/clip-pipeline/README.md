# @vtorn/clip-pipeline

Highlight detection + ffmpeg clip-render service for VTourn social distribution
(see [docs/14-clip-generation-and-social.md](../../docs/14-clip-generation-and-social.md)).

This service produces shareable 6–30s vertical (9:16), square (1:1), and
landscape (16:9) clips of key match moments — goals, near-misses, penalty
kicks — for distribution to TikTok, Instagram Reels, YouTube Shorts, and
Twitter / X.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/clip` | Queue a render. Returns `{ clip_id, status, cached }`. |
| `GET`  | `/v1/clip/:clip_id` | Poll status (`queued`, `rendering`, `done`, `failed`) and grab the URL. |
| `GET`  | `/v1/clip/:clip_id/file` | Stream the rendered MP4 (immutable, content-addressed by SHA-256). |
| `GET`  | `/v1/match/:match_id/highlights` | Auto-detected highlight reel for a match (from the StatsBomb / spec event stream). |
| `POST` | `/v1/auto-trigger/start` | Subscribe to a match stream and auto-render clips on goal / red card / penalty / match end. Body `{ matchId, streamUrl }`. |
| `POST` | `/v1/auto-trigger/stop` | Stop a per-match subscription. Body `{ matchId }`. |
| `GET`  | `/v1/auto-trigger` | List active subscriptions. |
| `GET`  | `/healthz` | Liveness + ffmpeg availability + active-trigger count. |

## Running locally

```bash
cd apps/clip-pipeline
cp .env.example .env
pnpm install
pnpm dev          # http://localhost:3380
```

Smoke-test the service:

```bash
# 1. Liveness.
curl -s http://localhost:3380/healthz | jq

# 2. Queue a clip.
curl -s -X POST http://localhost:3380/v1/clip \
  -H 'content-type: application/json' \
  -d '{
    "match_id": "fifa-wc-2022-final-arg-fra",
    "start_ms": 6480000,
    "end_ms":   6495000,
    "format": "9:16",
    "src": "/path/to/raw-render.mp4",
    "overlay": {
      "scoreline": "ARG 3 - 2 FRA",
      "scorer":    "Messi",
      "minute":    "108'\''"
    }
  }' | jq

# 3. Poll for completion.
CLIP=clip_abc123
curl -s http://localhost:3380/v1/clip/$CLIP | jq

# 4. Stream the file once status == "done".
curl -O http://localhost:3380/v1/clip/$CLIP/file

# 5. Get the auto-detected highlight reel for a match.
curl -s 'http://localhost:3380/v1/match/fifa-wc-2022-final-arg-fra/highlights?limit=10' | jq

# 6. Auto-trigger clips from a live match stream.
curl -s -X POST http://localhost:3380/v1/auto-trigger/start \
  -H 'content-type: application/json' \
  -d '{"matchId":"fifa-wc-2022-final-arg-fra","streamUrl":"ws://localhost:4002/v1/match/fifa-wc-2022-final-arg-fra"}' | jq

# Stop it again.
curl -s -X POST http://localhost:3380/v1/auto-trigger/stop \
  -H 'content-type: application/json' \
  -d '{"matchId":"fifa-wc-2022-final-arg-fra"}' | jq
```

### Auto-trigger flow

```
   producer/stream-server WS
            |
            v
   subscribeToMatchStream
            |  (filter: goal | red_card | penalty | match_end)
            v
   ClipQueue.submit(...)         <- existing render pipeline
            |
            v
   social-publisher /v1/publish  <- caption + hashtags from
                                    config/clip-captions.json
```

Captions are loaded once from `config/clip-captions.json` (repo root) keyed
by event type and clip format. Placeholders: `{home}`, `{away}`, `{scorer}`,
`{minute}`, `{score}`. Captions never contain emojis (validated at load).

If the social-publisher is offline or returns non-2xx, the dispatch payload is
appended to `data/failed-publishes.jsonl` for later retry. Active subscriptions
are persisted to `data/active-triggers.jsonl` so a restart re-subscribes
without operator action.

## Architecture

- **Highlight detector** (`src/highlights.ts`) — pure function over an
  `EventMessage[]` stream from `@vtorn/spec`. Scores each event by importance
  (goal=10, penalty=9, red=8, match_end=7, save=4, yellow=3, on-target shot=2),
  expands each into a (start, end) window, and greedy-merges overlapping
  windows. Deterministic; same input → byte-identical output.

- **Clip queue** (`src/queue.ts`) — in-memory FIFO with a strict
  `queued → rendering → done | failed` state machine. Jobs are
  content-addressed; resubmitting an identical request hits the cache.

- **ffmpeg runner** (`src/ffmpeg.ts`) — wraps `child_process.spawn`. The
  `FfmpegRunner` interface is mocked in tests so CI doesn't depend on a real
  ffmpeg binary. The argv builder (`buildFfmpegArgs`) is pure and tested
  directly.

- **HTTP layer** (`src/api.ts`) — Fastify v5 + `@fastify/cors`. Validates
  request bodies, attaches platform-appropriate cache headers, and streams
  the rendered MP4 with `Cache-Control: public, max-age=31536000, immutable`.

## Caching policy

Per docs/22-deployment-and-tunnels.md:

| Surface | Cache header | Why |
|---------|--------------|-----|
| `POST /v1/clip` | `no-store` | mutates server state |
| `GET /v1/clip/:id` while not done | `no-store` | actively changing |
| `GET /v1/clip/:id` when done | `public, max-age=300` | done jobs are stable |
| `GET /v1/clip/:id/file` | `public, max-age=31536000, immutable` | content-addressed by SHA |
| `GET /v1/match/:id/highlights` | `public, s-maxage=30, stale-while-revalidate=120` | recomputable, but stable for the duration of a match |
| `GET /healthz` | (none) | trivially fast |

## Environment variables

See `.env.example`. The service does not require any secrets; in production it
relies on object storage (S3 / R2) addressed via `CLIP_STORAGE_URL`.

## Tests

```bash
pnpm test          # vitest, single fork
pnpm typecheck     # tsc --noEmit including tests
```

ffmpeg is **not** spawned during tests — the runner interface is mocked.
This keeps CI reproducible regardless of the host's encoder version.

## What this layer does NOT do (yet)

- **Headless renderer integration** — the `src` field is a stub for now.
  When the headless renderer ships (per docs/14), this service will spawn it,
  capture frames, and pipe them to ffmpeg.
- **TTS commentary mix and audio bed** — same; deferred.
- **Direct platform posting** (TikTok / Instagram / YouTube APIs) — handled
  by a sibling distribution service that polls this one.

These are tracked in [IDEAS.md](../../IDEAS.md) under "clip-pipeline next".

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/clip-pipeline.openapi.json`](../../docs/api/clip-pipeline.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/clip-pipeline run dump-openapi
# or @vtourn/odds-ingest / @vtorn/wc2026-data-scripts
```
