# Session - clip-pipeline auto-trigger (2026-05-10)

**Agent**: clip-pipeline builder
**Branch**: `feat/clip-pipeline-auto-trigger`
**Status**: complete

## Plan

Wire `apps/clip-pipeline` to auto-trigger on match-stream events instead of
being manually invoked. Goal-scored / red-card / penalty / match-end events
arriving in the producer's stream should cause clips to render and dispatch
to the social-publisher.

## What landed

- `apps/clip-pipeline/src/lib/event-trigger.ts` - `subscribeToMatchStream` +
  `SubscriptionManager` + JSONL `TriggerStore` + default `PublisherClient`.
  Maps spec events (`event.goal`, `event.foul[severity=red]`,
  `event.penalty_attempt` / `event.out_of_bounds[restart=penalty]`,
  `event.match_end`) onto clip-render configs (per-event window + format set).
- `apps/clip-pipeline/src/captions.ts` - caption template loader + renderer.
  Validates that captions / hashtags are pure ASCII (rejects emojis at load).
- `config/clip-captions.json` - templates keyed by event type and clip format
  with `{home}`, `{away}`, `{scorer}`, `{minute}`, `{score}` placeholders.
- `apps/clip-pipeline/src/api.ts` - new endpoints:
  - `POST /v1/auto-trigger/start` `{ matchId, streamUrl }`
  - `POST /v1/auto-trigger/stop` `{ matchId }`
  - `GET  /v1/auto-trigger` (list active)
  - `/healthz` now reports `active_triggers`.
- `apps/clip-pipeline/src/index.ts` - boot path wires the SubscriptionManager,
  loads/persists `data/active-triggers.jsonl`, and passes the manager into
  the API. Resumes in-flight subscriptions on restart.
- `apps/clip-pipeline/src/config.ts` - new env vars
  `CLIP_ACTIVE_TRIGGERS_PATH`, `CLIP_FAILED_PUBLISHES_PATH`,
  `CLIP_PUBLISHER_BASE_URL` (default `http://localhost:3382`).
- 21 new tests in `test/event-trigger.test.ts` covering normalisation, the
  full goal flow (3 formats + caption + hashtags + queue), red-card / penalty
  / match-end windows, publisher failure dead-lettering (both non-2xx and
  thrown), JSONL store round-trip, manager rebind / resume, and the HTTP
  endpoints.

## Quality gates

- `pnpm typecheck` clean
- `pnpm test` clean (102 tests pass; 21 new)
- Server boots, JSONL is created on `start`, removed on `stop`, healthz
  reports the count.

## TODO (deferred)

- Real-WS integration with the live stream-server is unblocked but untested
  end-to-end; the smoke test points at a closed port to verify reconnect
  backoff fires.
- A retry worker for `data/failed-publishes.jsonl` (out of scope for this
  PR; tracked in IDEAS).
- Per-tournament caption / hashtag overrides; current templates are global.

## Constraints honoured

- Existing manual render endpoints unchanged.
- No new DB. JSONL files are the only persistence.
- Captions validated to forbid emojis at load.
- Degrades gracefully when the publisher is offline (logs + dead-letters).
