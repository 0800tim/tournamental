# 2026-05-10 — clip-pipeline builder — initial build

- **Task**: build `apps/clip-pipeline/` per docs/14-clip-generation-and-social.md.
- **Branch**: `feat/clip-pipeline`
- **Status**: complete

## Plan

1. Scaffold `apps/clip-pipeline/` as a pnpm workspace package mirroring the `apps/odds-ingest` shape (Fastify v5, vitest, ESM, strict TS).
2. Implement the highlight detector as a pure function over `EventMessage[]` from `@vtorn/spec` — score by importance, greedy-merge overlapping windows.
3. Build the Fastify HTTP server with five routes: `POST /v1/clip`, `GET /v1/clip/:id`, `GET /v1/clip/:id/file`, `GET /v1/match/:id/highlights`, `GET /healthz`.
4. Implement an in-memory clip job queue with a state machine (`queued → rendering → done | failed`) and content-addressable IDs (SHA-256 of inputs).
5. Wire `child_process.spawn` to drive ffmpeg with a `drawtext` overlay; mock the spawn in tests so CI doesn't depend on actual encodes.
6. Write 25+ vitest unit + endpoint tests.
7. Add `.env.example`, README, and update `docs/22-deployment-and-tunnels.md` to add port 3380 + `vtorn-clip.aiva.nz`.

## Key decisions

- Highlight detector lives in `src/highlights.ts` as a pure function so it stays trivially testable.
- Clip ID = `sha256(match_id|start_ms|end_ms|format|overlay_json).slice(0,16)` — deterministic + collision-resistant for our scale.
- Storage layer is pluggable: filesystem in dev, but `getClipUrl(clip_id)` honours `CLIP_STORAGE_URL` env so prod can point at R2/S3.
- ffmpeg is invoked through a `FfmpegRunner` interface that the test suite swaps for a fake — no spawned processes in CI.
- Job queue is in-memory only; persisting jobs across restarts is out of scope for this PR (parked in IDEAS).

## Open questions for orchestrator

- (none blocking) — when the headless renderer ships, this service will need an HTTP fetch path to grab raw frames. Stubbed via `?src=...` query in the request body for now.

## Outcome

- 81 vitest tests pass; lint + typecheck clean.
- 5 endpoints live: `POST /v1/clip`, `GET /v1/clip/:id`, `GET /v1/clip/:id/file`,
  `GET /v1/match/:id/highlights`, `GET /healthz`.
- Highlight detector validated against an AR-FR 2022 final fixture: produces
  9 highlights (6 goals, 1 yellow, 1 save, 1 match_end) from 11 events, with
  the two ET penalties correctly merged into their goal windows.
- `docs/22` updated with port 3380 + tunnel `vtorn-clip.aiva.nz` and the
  caching policy table extended with the new clip surfaces.
- ffmpeg never spawned in CI — runner interface is mocked.

## Next steps

Once the headless renderer ships, wire it via a new `RendererClient` so
`POST /v1/clip` can render frames directly instead of relying on a `src` field.
Distribution layer (Telegram / Instagram / TikTok) is a sibling service that
polls this one — out of scope for this PR.
