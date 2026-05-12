---
name: producer-author
description: Author a data producer that streams spec-conformant messages into the Tournamental match pipeline. Goals, commentary, odds, quizzes, leaderboard chat — anything time-coded.
license: Apache-2.0
---

# When to use this skill

You're a contributor (human or AI agent) building a **live data
producer** that emits time-coded match content into Tournamental's
WebSocket pipeline. Examples that are open for the FIFA WC 2026:

- A live-tracking feed for a match (your data source is a paid
  tracking provider, a video-CV pipeline, a manual scoreboard).
- A live commentary audio track in your language, streamed in
  real time alongside the match data.
- A live odds feed beyond the bundled Polymarket + The Odds API
  sources.
- A live player-market-stats feed (xG, pass-completion %, sprint
  count, possession heatmap deltas).
- A live in-match challenge / quiz pulse ("predict the next
  corner-taker; 50 pts").
- A live leaderboard-chat feed (banter alongside the ranking,
  syndicate-scoped or public).

If the data is **per-match, time-coded, and arrives during play**,
this skill is the right entry point. If it's pre-match analysis or
post-match recap, see
[`docs/12-odds-and-predictions.md`](../../docs/12-odds-and-predictions.md)
or the news-aggregator service.

# How to do it

## 1. Fork the example producer

```bash
cp -r examples/hello-producer my-producer
cd my-producer
```

The example is a 200-line Node script. It listens on a WebSocket,
emits a `match.init` then `state` frames at 30 Hz, plus scripted
goal events. Real producers replace the `tick()` function with
their data source.

The example uses the canonical `@tournamental/spec` shape
([`packages/spec/src/index.ts`](../../packages/spec/src/index.ts)):

```ts
type Message = MatchInit | StateFrame | EventMessage;
```

## 2. Pick the spec variant you need

| Producer kind | Primary message types |
| --- | --- |
| Live tracking | `state` (30 Hz) + `event.*` |
| Goal-only / "manual ticker" | `event.kickoff`, `event.goal`, `event.score_change`, `event.match_end` |
| Commentary audio | Side channel — see "Audio streams" below |
| Live odds | Side channel — see "Auxiliary streams" |
| Quizzes / challenges | Side channel + REST submission endpoint |
| Leaderboard chat | Separate `chat.tournamental.com` WebSocket — see [docs/58](../../docs/58-data-producers.md) |

The renderer at `apps/web/lib/renderer/` consumes the primary
WebSocket; the auxiliary streams compose alongside it.

## 3. Audio streams

For a commentary track keyed to the match clock:

- Open a separate WebSocket at
  `wss://stream.tournamental.com/match/<match-id>/audio` (or
  `ws://localhost:4001/audio` in dev).
- Emit a `manifest` JSON message first: language, voice, sample
  rate, opus or mp3, base URL of chunks.
- Then either:
  - Push opus/mp3 binary frames with millisecond match-clock
    tags (live TTS, recommended for cost-controlled sources), or
  - Push a manifest of pre-rendered chunk URLs and let the
    renderer pull them (recommended for batch-rendered tracks).

See [`docs/31-commentary.md`](../../docs/31-commentary.md) for the
audio mixer's expectations and
[`apps/web/lib/audio/`](../../apps/web/lib/audio/) for the
client-side consumer.

## 4. Auxiliary data streams (odds, stats, quizzes, challenges)

These do not belong on the primary match WebSocket — they have
different update cadences, different durability requirements, and
different consumer surfaces (chips, side panels, modals).

The convention is one auxiliary WebSocket per stream kind:

- `wss://stream.tournamental.com/match/<id>/odds` — `OddsSample`
  shape from `@tournamental/plugin-sdk`. One sample per outcome,
  per provider.
- `wss://stream.tournamental.com/match/<id>/playerstats` —
  cumulative + delta stats per player (xG, sprints, passes).
- `wss://stream.tournamental.com/match/<id>/challenges` —
  `challenge.open` / `challenge.close` events with a points
  payout schedule and a submission endpoint.
- `wss://stream.tournamental.com/match/<id>/chat` — leaderboard
  banter, syndicate-scoped or public.

Schemas for these are listed in
[`docs/58-data-producers.md`](../../docs/58-data-producers.md). Some
are stabilising; if your producer needs a variant that does not
exist yet, open an RFC PR adding it to `packages/spec/`.

## 5. Run the renderer against your producer

```bash
# Terminal 1: your producer
node my-producer/src/index.mjs       # listens on :4001

# Terminal 2: the renderer
pnpm --filter @vtorn/web dev          # :3300
# Open http://localhost:3300/match/<your-match-id>
```

The renderer reads `NEXT_PUBLIC_VTORN_WS_URL` (default
`ws://localhost:4001`) on every match page. If it sees `match.init`
followed by `state`, you're live.

## 6. Ship it as a plugin

Producers that should run inside any Tournamental deployment (not
just your laptop) ship as plugins implementing the `IngestPlugin`
interface at
[`packages/plugin-sdk/src/index.ts`](../../packages/plugin-sdk/src/index.ts):

```ts
export interface IngestPlugin {
  readonly label: string;
  readonly id: string;
  listAvailableMatches?(): Promise<IngestMatchDescriptor[]>;
  start(opts: IngestStartOpts, subscriber: IngestSubscriber): Promise<IngestSession>;
}
```

Scaffold via:

```bash
npm create @tournamental/app --template producer-ingest
```

That generates a `packages/plugins/<your-name>/` with the
manifest, types, and a passing test wired up.

# Acceptance checks

- `node my-producer/src/index.mjs` boots without error and
  prints "listening on ws://localhost:4001/".
- `wscat -c ws://localhost:4001/` receives a `match.init`
  within 2 seconds and a `state` within 5 seconds.
- The renderer at `play.tournamental.com/match/<match-id>`
  shows your match data live (players moving, score updating,
  HUD clock advancing).
- For audio: the renderer's audio mixer console-logs the
  commentary track playing in sync with goal events.
- Your plugin's vitest passes with a fixture that asserts the
  first 60s of output is spec-valid.

# Boundaries

- DO NOT modify `packages/spec/` without an orchestrator-approved
  spec-change PR. Adding a new auxiliary stream type goes through
  RFC.
- DO NOT publish your producer to a public URL until it has
  passed the spec-conformance test in
  [`packages/spec-client/`](../../packages/spec-client/). A
  malformed producer takes the renderer down.
- DO NOT emit personally-identifying audio without consent. The
  reviewer agent rejects producers that send raw user voice;
  TTS-generated voices are fine.
- DO NOT use the word "gambling" anywhere in the producer's
  surface area, docs, or commit messages. The platform is
  points-based, no real money. The accepted vocabulary is
  "wagering", "sweepstakes", "betting", "predictions",
  "challenges".
