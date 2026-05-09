# @vtorn/mock-producer

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 4. See [docs/05-mock-producer.md](../../docs/05-mock-producer.md).

Node 20+ TypeScript synthetic match generator. Emits a deterministic 90-min soccer match in canonical [`@vtorn/spec`](../../packages/spec) v0.1.1 shape. Useful as a fast renderer-dev fixture and as the public "always-on" demo stream when no live game is active.

The CLI shape mirrors `apps/statsbomb-replay/`'s producer so the renderer code in `apps/web/` is identical for both.

## Install

From the repo root:

```bash
pnpm install
```

This installs all workspace dependencies including `seedrandom`, `commander`, and `ws`.

## Run

```bash
cd apps/mock-producer

# Stream NDJSON to stdout (handy for piping into anything).
pnpm start -- --seed=42 --out=stdout

# Serve on a WebSocket the renderer can connect to.
pnpm start -- --seed=42 --out=ws --port=4001

# Serve on SSE.
pnpm start -- --seed=42 --out=sse --port=4001 --path=/stream

# Write a CDN-style snapshot (init.json + chunked .ndjson.gz + live.m3u8).
pnpm start -- --seed=42 --out=file --path=./out

# Run a 90-min match in 9 minutes.
pnpm start -- --seed=42 --out=ws --port=4001 --time-scale=10
```

## CLI options

| flag | default | meaning |
| ---- | ------- | ------- |
| `--seed <value>` | `42` | RNG seed; same seed gives byte-identical output |
| `--match-duration-ms <ms>` | `5400000` | match duration (ms of match time) |
| `--time-scale <factor>` | `1` | wall-clock multiplier (1 = real time, 10 = 10x) |
| `--out <ws\|sse\|file\|stdout>` | `stdout` | output mode |
| `--port <n>` | `4001` | TCP port for `ws` / `sse` |
| `--path <value>` | `./out` | for `file`: target dir. For `ws`/`sse`: URL path (must start with `/`) |
| `--teams <path.json>` | (none) | optional rosters override; JSON must contain `teams: [Team, Team]` |

## Determinism

A given `--seed` reproduces an exact byte-for-byte match: the simulation is a pure function of `(seed, duration, teams)` and emitters are pure transports. The `tests/determinism.test.ts` suite asserts byte equality across two runs with the same config and proves that different seeds diverge.

## Spec validation

Every emitted message is validated against `@vtorn/spec` types in `tests/spec-validation.test.ts`. The validator (`src/validator.ts`) is exported from the package and can be reused by other producers.

## Output coverage

A default 90-min match emits at least one of every standard event type:

`event.kickoff`, `event.pass`, `event.shot`, `event.goal`, `event.save`, `event.tackle`, `event.foul`, `event.out_of_bounds`, `event.substitution`, `event.period_start`, `event.period_end`, `event.match_end`, plus `event.score_change` and `event.commentary`.

The default seed produces 1–4 goals (`tests/event-coverage.test.ts` asserts this).

## What it doesn't do

- No real football tactics: motion is "carrier runs at goal, others drift to formation slots with damped noise". Goal is renderer coverage, not realism.
- No physics collisions: ball is linear xy + parabolic z.
- One process, one match. To run multiple, run multiple.

A more realistic simulator lives in `apps/sim-producer/` later. This package is purely the renderer-dev fixture.

## Spec contract

Consumes `@vtorn/spec` workspace dep at `SPEC_VERSION = "0.1.1"`. Spec changes are orchestrator-only — see [CONTRIBUTING.md § Spec changes](../../CONTRIBUTING.md#spec-changes).

## Tests

```bash
pnpm test         # run vitest suites
pnpm typecheck    # tsc --noEmit
```

Test suites:

- `determinism.test.ts` — same seed gives byte-identical NDJSON.
- `spec-validation.test.ts` — every message validates; init has `spec_version="0.1.1"`; state frames at 10Hz.
- `event-coverage.test.ts` — every standard event type appears; default seed yields 1–4 goals.
- `motion.test.ts` — no teleports between consecutive state frames in normal play; ball stays in bounds.
- `file-emitter.test.ts` — `--out file` writes init.json + chunked NDJSON.gz + live.m3u8.
- `ws-emitter.test.ts` — a WS client receives match.init plus state frames; every frame validates.
