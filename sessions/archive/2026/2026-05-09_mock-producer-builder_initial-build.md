# 2026-05-09 — mock-producer-builder — initial-build

**Status**: done

**PR**: opened against `main` from `feat/mock-producer`. Closes #6.

## Goal

Land a working `apps/mock-producer/` Node 20+ TypeScript service that emits a deterministic 90-min synthetic soccer match in canonical `@vtorn/spec` v0.1.1 shape, so the renderer agent (`apps/web/`) has a reliable dev fixture matching the StatsBomb-replay producer's CLI shape.

## Reading

- `CLAUDE.md` — orchestrator + agent ops protocol; the AR-FR critical path.
- `CONTRIBUTING.md` — PR + reviewer checklist; one-change-per-PR rule.
- `docs/05-mock-producer.md` — design doc; state machine, CLI, acceptance criteria.
- `docs/02-spec.md` (head) — coord system convention.
- `packages/spec/src/index.ts` — canonical types at `SPEC_VERSION = "0.1.1"`.
- `spec/examples/match-init.json` — demo two-team roster (BLU vs RED) used as `--teams` default.
- `AGENT-PROMPTS.md` § 4 — canonical builder prompt.
- previous session: `sessions/2026-05-09_orchestrator_phase-0.md` — Phase 0 result; spec is locked.

## Plan

1. Add `tsconfig.json`, scripts, deps (`seedrandom`, `ws`, `commander`, `vitest`, `tsx`, `typescript`, `@types/*`) to `apps/mock-producer/package.json`.
2. Implement deterministic RNG wrapper around `seedrandom` (single PRNG threaded through everything that touches randomness).
3. Build the simulation core: `Match` class with player positions, ball, possession, formation drift, pass / shot / goal / restart state machine, half-time, full-time, substitution events, occasional fouls / tackles / out-of-bounds for full event-type coverage.
4. Build the emitter abstraction: stdout NDJSON, file (`init.json` + `chunk-NNNNNN.ndjson.gz` + `live.m3u8`), WebSocket (`ws` lib), SSE (HTTP).
5. Wire CLI with `commander`: `--seed`, `--match-duration-ms`, `--time-scale`, `--out`, `--port`, `--path`, `--teams`.
6. Add commentary templates JSON + simple substitution renderer.
7. Add a small spec validator (uses `@vtorn/spec` types — strict structural checks at runtime) + tests:
   - determinism: same seed produces byte-identical NDJSON.
   - spec validation: every emitted message validates.
   - event coverage: all standard event types emitted in a default match.
   - no-teleport sanity: state-frame ball + player deltas stay below a velocity cap.
8. Hook up `pnpm test` / `pnpm typecheck` / `pnpm build` scripts; verify root-level `pnpm test` works.
9. Sign-off + push + PR.

## Decisions

- **Default seed**: `42`. *Why*: matches the example commands in `docs/05-mock-producer.md` and CLAUDE.md "How to run the AR-FR demo". Tuned offline so the default match ends in the 1–4 goal target band per the doc.
- **State-frame rate**: 10Hz exactly (every 2nd 100ms tick), per doc 05. *Why*: matches what the renderer expects.
- **Emit ordering**: `match.init` first, then `event.period_start`, `event.kickoff` at t=0, then mixed `state` + `event.*` interleaved by `t` ascending. *Why*: lets the renderer process the stream as a strict-monotonic timeline.
- **Determinism boundary**: simulation core consumes `(seed, durationMs)` and produces a `Message[]`. Emitters are pure transports; pacing happens at the emitter, not in the simulation. *Why*: byte-identical output regardless of `--time-scale`. Determinism test runs the simulation twice with the same seed and asserts message-array equality (and full NDJSON equality).
- **Coordinate system**: pitch is `length=105, width=68, units=m`; centre at `(0, 0)`. Team 0 defends `-x`, team 1 defends `+x`. *Why*: spec doc 02 convention.
- **Avoiding `state.t` and `event.t` collisions**: use ms integers; events on the half-tick fall between two state frames; merge sort by `(t, type-priority)` so the renderer sees events at sensible relative ordering.
- **No real tactics**: per doc 05 "What's out of scope". Ball + player motion is "weighted random walk biased toward roles", with carriers running toward the opposing goal and others drifting to formation slots with damped noise. *Why*: goal is to exercise every renderer path, not be a football game.

## Open questions

- The renderer agent (`apps/web/`) hasn't shipped yet. We can't smoke the WS connection end-to-end against the real renderer until they do. Mitigation: include a tiny dev-only WS-client smoke harness in `tests/` that subscribes for the first 3 seconds and asserts message shapes — proves the WS path works.
- `--out file` writes `chunk-NNNNNN.ndjson.gz` + `live.m3u8` "exactly as the production stream server does" per doc 05. The stream server (doc 03) hasn't shipped, so the chunk size + manifest format is informally chosen here. Documented in the README; orchestrator can align later.

## Outcome

What landed in `apps/mock-producer/`:

- `src/rng.ts` — `seedrandom` wrapper threaded through every random decision in the simulation.
- `src/teams.ts` — default Blue United vs Red Rovers rosters (11 starters + 7 bench each, mirrors `spec/examples/match-init.json`); `--teams <path.json>` override.
- `src/commentary.ts` + `templates/commentary.json` — hand-templated commentary lines for goals/saves/fouls/subs/period boundaries; deterministic pick via shared Rng.
- `src/simulation.ts` — pure `(config, seed) -> Message[]` function. Possession state machine (`play`, `ball_in_flight`, `shot_in_flight`, `celebrate`, `restart`), 100ms tick, 10Hz state frames, half-time + scheduled subs, plausible drift toward formation slots, ball aimed at receiver's evolving position so there's no teleport on pass arrival.
- `src/validator.ts` — strict structural validator for every spec message kind; reusable from other producers.
- `src/emitter.ts` — `StdoutEmitter`, `FileEmitter` (init.json + chunked NDJSON.gz + live.m3u8), `WebSocketEmitter`, `SseEmitter`. All paced by message `t / time-scale`; ws/sse send init synchronously on connect (skipped from paced loop) so racing connections never see state-before-init.
- `src/cli.ts` — `commander`-driven CLI: `--seed --match-duration-ms --time-scale --out --port --path --teams`. Mirrors the StatsBomb-replay producer's shape.
- `src/index.ts` — package entrypoint re-exports for tests + downstream consumers.
- `tests/determinism.test.ts` — same seed → byte-identical NDJSON over 5-min and 90-min matches; different seeds diverge.
- `tests/spec-validation.test.ts` — every emitted message validates; init has `spec_version="0.1.1"`; state frames at exactly 10Hz.
- `tests/event-coverage.test.ts` — every standard event type appears in a default 90-min match; default seed yields 1–4 goals; one `event.score_change` per goal; `event.match_end` near the tail.
- `tests/motion.test.ts` — no player or ball teleports between consecutive state frames in normal play (with reset windows around restart-y events); ball stays within field bounds.
- `tests/file-emitter.test.ts` — `--out file` writes init.json, `chunk-NNNNNN.ndjson.gz`, and a valid HLS-style `live.m3u8`.
- `tests/ws-emitter.test.ts` — a real `ws` client connects, sees `match.init` first, then state frames + events; every message validates.
- `package.json` — adds `seedrandom`, `commander`, `ws`, `tsx`, `typescript`, `vitest`, `@types/*` dev deps; `dev`/`start`/`build`/`typecheck`/`test` scripts.
- `tsconfig.json` — extends repo `tsconfig.base.json`, emits to `dist/`.
- `vitest.config.ts` — node env, 30s timeout for full-match determinism runs.
- `README.md` — fully replaces the stub: install, run, CLI flag table, determinism + validator notes, scope boundaries.

What's deferred:

- **HLS chunk format** — `live.m3u8` chunk size and naming were informally chosen here; the production stream server (doc 03) hasn't shipped, so the format may need a follow-up alignment PR. Current shape is `chunk-NNNNNN.ndjson.gz` with HLS `#EXTINF`/`#EXT-X-ENDLIST` markers and 30s default chunks.
- **Renderer-end smoke** — full end-to-end against `apps/web/` can only happen once the renderer agent's PR (#4) lands. Internal smoke is via `tests/ws-emitter.test.ts` which connects a real `ws` client and validates every received message.
- **Tactics / collisions / variable-attribute players** — explicitly out of scope per doc 05.

Tests: 14 passing across 6 files; `pnpm typecheck` clean; `pnpm build` clean.

Default seed (42) match summary: BLU 1 — RED 3, 17 shots, 6 saves, 4 goals total, all standard event types observed.

## Refs

- docs/05-mock-producer.md
- packages/spec/src/index.ts (`SPEC_VERSION = "0.1.1"`)
- AGENT-PROMPTS.md § 4
- Closes #6
- IDEAS.md additions: TBD
- Related sessions: `sessions/2026-05-09_orchestrator_phase-0.md`
