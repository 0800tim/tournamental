# 58. Data Producers

> The reference for everyone authoring **live data producers** for
> Tournamental. Goals, commentary, odds, player stats, leaderboard
> chat, in-match challenges and quizzes, audio tracks — anything
> time-coded that streams into a match.

This doc is the contract you build against. It exists so a new
contributor can land a working producer in a day and a real-time
producer running during a FIFA World Cup 2026 match in a week.

## What is a producer

A producer is **any process that streams spec-conformant messages
keyed to a match**. The shape is intentionally narrow:

```
producer ──ws──> stream-server ──ws──> renderer + scorer + chat-room + ...
```

A producer's only job is to emit messages on a WebSocket. The
stream server fans those out to many subscribers per match-id;
the renderer, the live-odds chips, the leaderboard chat, the
audio mixer, and any plugin renderer compose them into the user
experience.

Producers do not have to live inside this repo. The reference
producer (`apps/statsbomb-replay/`) is Python; the synthetic dev
producer (`apps/mock-producer/`) is Node TypeScript; the example
in [`examples/hello-producer/`](../examples/hello-producer/) is
~200 lines of plain Node. Producers can be Rust, Go, Bun, an FFI
binding to a tracking-data SDK — the wire protocol is JSON
messages over WebSocket; any language that speaks WebSocket fits.

## The five things a producer can stream

| Stream | Cadence | Carries | Spec status |
| --- | --- | --- | --- |
| **Primary match** | 30 Hz state + sparse events | ball position, players, goals, shots, fouls, substitutions, score, match-end | **Stable** in `@tournamental/spec` v0.1.1 |
| **Audio commentary** | continuous; opus or mp3 chunks | language-tagged voice track keyed to the match clock | **Stabilising**; manifest + chunked URLs OR live binary WS |
| **Live odds** | 1-10 s | implied probabilities per outcome, per provider | **Stable** as `OddsSample` in `@tournamental/plugin-sdk`; WS surface stabilising |
| **Player market stats** | 5-30 s | per-player xG, sprint count, pass-completion %, pressure index, possession-zone heatmap deltas | **RFC** — schema in this doc |
| **Live challenges / quizzes / chat** | event-driven | `challenge.open`, `challenge.close`, `quiz.question`, `chat.message`, points-payout schedule | **RFC** — schema in this doc |

The five are intentionally separate streams because they have
different update cadences, different durability needs (the
primary match stream is replayable; chat is not), and different
consumer surfaces (chips, side panels, modals, full-screen
overlays). A producer can run one stream or several, but each
goes on its own WebSocket.

## Connection model

### Primary match stream

```
ws://stream.tournamental.com/match/<match-id>
```

The subscriber connects, the producer (or the stream-server
holding the producer's connection) sends:

1. `match.init` once.
2. `state` frames at 30 Hz until the match ends.
3. `event.*` messages interleaved at human-relevant moments.

All messages are JSON, one per `ws.send()`. `match.init` carries
`spec_version`; the renderer enforces a version match against
`@tournamental/spec`'s exported `SPEC_VERSION`.

### Auxiliary streams

Each auxiliary stream is its own WebSocket on a path suffix:

```
ws://stream.tournamental.com/match/<id>/audio
ws://stream.tournamental.com/match/<id>/odds
ws://stream.tournamental.com/match/<id>/playerstats
ws://stream.tournamental.com/match/<id>/challenges
ws://stream.tournamental.com/match/<id>/chat
```

The renderer subscribes to whichever auxiliary streams the user
has opted into. Producers register at the stream server with
which streams they emit; the operator picks one or more per
match.

## Message shapes

The primary stream's types are
[`@tournamental/spec`](../packages/spec/src/index.ts). Read the
source, not paraphrased docs. The discriminated union is:

```ts
type Message = MatchInit | StateFrame | EventMessage;
```

The 15+ event variants cover the football lifecycle:
`event.kickoff`, `event.pass`, `event.shot`, `event.goal`,
`event.tackle`, `event.foul`, `event.save`, `event.out_of_bounds`,
`event.substitution`, `event.score_change`, `event.period_start`,
`event.period_end`, `event.match_end`,
`event.penalty_shootout_start`, `event.penalty_attempt`.

For the auxiliary streams the shapes are described below. Some
are stable; some are RFC. If you want to ship a producer against
an RFC shape, open the spec-change PR first so we converge on
the wire format.

### Audio commentary (stabilising)

The first message on the audio channel is a `commentary.manifest`:

```json
{
  "type": "commentary.manifest",
  "language": "en-NZ",
  "voice_id": "lucia",
  "voice_label": "Lucia (en-NZ, expressive)",
  "format": "opus",
  "sample_rate_hz": 48000,
  "mode": "chunked-urls",
  "chunk_base_url": "https://cdn.example.com/audio/en-NZ/match-xyz/",
  "chunk_manifest_url": "https://cdn.example.com/audio/en-NZ/match-xyz/manifest.json"
}
```

After the manifest the producer chooses one of two modes:

- **`chunked-urls`** — the producer emits `commentary.cue` JSON
  messages tagging match-clock millis to chunk file names. The
  client pulls audio from the CDN. Best for pre-rendered batch
  output (e.g. an offline ElevenLabs render of a recorded match).

  ```json
  { "type": "commentary.cue", "t_ms": 720000, "chunk": "00012.opus", "duration_ms": 4200 }
  ```

- **`live-binary`** — the producer pushes opus/mp3 binary frames
  on the WebSocket, prefixed with a small JSON header. Best for
  live TTS via ElevenLabs realtime or a similar streaming TTS.

  ```
  ws.send(JSON.stringify({ type: "commentary.head", t_ms: 720000, len: 1820, codec: "opus" }))
  ws.send(opusFrameBuffer)
  ```

Pre-rendered MP3 batch infrastructure already exists at
[`apps/web/lib/audio/pre-rendered-track.ts`](../apps/web/lib/audio/pre-rendered-track.ts);
live TTS reuses the same audio mixer. See
[`docs/31-commentary.md`](31-commentary.md).

### Live odds (stable shape)

The producer pushes one `OddsSample` per outcome per cadence:

```json
{
  "type": "odds.sample",
  "match_id": "fifa-wc-2026-final",
  "fetched_at_ms": 1718374261000,
  "staleness_seconds": 0,
  "outcomes": { "home_win": 0.42, "draw": 0.27, "away_win": 0.31 },
  "provider_id": "polymarket",
  "provider_url": "https://polymarket.com/event/..."
}
```

Probabilities sum to 1.0 ± 0.02 (allowance for vig). The
`OddsSample` type is shared with the `OddsSourcePlugin` interface
at
[`packages/plugin-sdk/src/index.ts`](../packages/plugin-sdk/src/index.ts).

### Player market stats (RFC)

Per-player cumulative stats and a delta since the previous tick:

```json
{
  "type": "playerstats.tick",
  "t_ms": 720000,
  "players": [
    {
      "id": "ARG-MESSI",
      "xg_total": 0.41,
      "xg_delta": 0.12,
      "passes": 28, "passes_completed": 25,
      "sprints": 4,
      "pressures": 9,
      "touches": 41,
      "heatmap_zone_deltas": {"third_a": 0.04, "third_m": 0.18, "third_d": 0.02}
    }
  ]
}
```

Cadence: 5-30 s. Consumer surfaces this as "Player chips" beside
the bracket and as a tap-to-expand modal in the renderer overlay.

### Live challenges and quizzes (RFC)

Designed for in-match, points-based prediction pulses. **All
challenges are no-real-money** — points-based sweepstakes against
the bracket leaderboard, never wagers in currency. The vocabulary
the platform accepts is "wagering", "sweepstakes", "betting",
"predictions", "challenges". Avoid the word "gambling".

```json
{
  "type": "challenge.open",
  "challenge_id": "next-corner-78m",
  "match_id": "fifa-wc-2026-final",
  "opened_at_ms": 720000,
  "closes_at_ms": 780000,
  "prompt": "Who takes the next corner?",
  "options": [
    { "id": "ARG-MESSI", "label": "Messi", "points_if_correct": 30 },
    { "id": "ARG-DIMARIA", "label": "Di María", "points_if_correct": 30 },
    { "id": "ARG-MAC-ALLISTER", "label": "Mac Allister", "points_if_correct": 50 },
    { "id": "OTHER", "label": "Someone else", "points_if_correct": 80 }
  ]
}
```

```json
{
  "type": "challenge.close",
  "challenge_id": "next-corner-78m",
  "closed_at_ms": 776000,
  "correct_option_id": "ARG-DIMARIA"
}
```

The renderer surfaces this as a pulse-card overlay. Users tap an
option before `closes_at_ms`; the game-service awards points on
`challenge.close`. Submissions go to
`POST /v1/challenge/<id>/answer` on the game-service, not back
through the WebSocket — the WebSocket is read-only.

A `quiz.question` variant follows the same pattern with a fixed
60-second `closes_at_ms` for trivia-style questions during
breaks-in-play.

### Leaderboard chat (RFC)

Same shape as a tiny IRC, scoped per syndicate or per match:

```json
{
  "type": "chat.message",
  "match_id": "fifa-wc-2026-final",
  "syndicate_slug": "office-pool",
  "t_ms": 720000,
  "from_handle": "@samh",
  "from_avatar_url": "https://...",
  "body": "Messi cooking right now",
  "in_reply_to": null
}
```

Producers for chat are unusual — typically the producer is the
chat service itself, not a third party — but the channel is
modelled here so other surfaces (a Discord bridge, a Telegram
bridge, an in-app pundit-feed) can re-emit chat events.

## Producer lifecycles

There are three lifecycles a producer can take:

1. **Replay producer** (StatsBomb-style). Has a static
   `listAvailableMatches()` catalogue. Stops when the match
   ends. Deterministic given the same `(match_id, time_scale,
   seed)`. Useful for testing, for the AR-FR demo, for any
   recorded match.

2. **Live producer** (WC 2026, live tracking, manual ticker).
   No catalogue; the operator supplies `match_id` at start.
   Cannot be replayed. Must handle reconnection if the source
   stream blips.

3. **Augmenting producer** (live odds, audio commentary, player
   stats, challenges, chat). Subscribes to the primary match
   stream as a downstream client, emits a transformed or
   enriched stream of its own. The challenge-curator producer
   for instance watches the primary stream for "shot just
   missed" events and opens a "what happens next?" challenge.

All three implement the same `IngestPlugin` interface; the
lifecycle is a property of the data source, not the plugin's
shape.

## Back-pressure

The stream server pauses producers whose subscriber buffers fill
up. The
[`IngestSubscriber`](../packages/plugin-sdk/src/index.ts) interface
exposes a `paused` boolean; producers MUST respect it. The
example producer in
[`examples/hello-producer/`](../examples/hello-producer/) shows
the pattern: skip a tick if `ws.bufferedAmount > 256 KB`.

For pure event producers (rare, low-volume) this is a non-issue.
For 30 Hz state-frame producers it is the first reason to drop a
match.

## Conformance testing

Every producer in `packages/plugins/` ships with a vitest fixture
that asserts the first 60 seconds of output is spec-valid. The
test harness lives at
[`packages/spec-client/`](../packages/spec-client/) — import
`assertSpecConformant(messageStream)` and your producer's
fixtures get the same gate the reference producers do.

## How to ship a producer

Two paths.

### Path A: a one-match script (fast)

Fork
[`examples/hello-producer/`](../examples/hello-producer/). Edit
`tick()`. Run it locally. Tunnel it to the stream server via your
own Cloudflare tunnel. Tell the operator the WebSocket URL; they
register it as a one-match source.

This is the right path for a producer you only run for the FIFA
WC 2026 group stage, or only for one fan-club syndicate, or only
as a demo to share on Twitter.

### Path B: a published plugin (canonical)

```bash
npm create @tournamental/app --template producer-ingest
```

Scaffolds a plugin implementing the `IngestPlugin` interface,
with a `plugin.json` manifest, a passing test, and the right
TypeScript types. Drop the package at `packages/plugins/<name>/`,
open the PR with label `skill: producer`.

The reviewer agent runs the producer-plugin checklist:
spec-conformance, back-pressure honoured, no PII in the stream,
idempotent restart, no use of the word "gambling" anywhere in
the codebase or docs.

Merged plugins join the
[Drips Network](https://www.drips.network) revenue split — the
plugin's `dripsListRef` opts in.

## Skills and reference

- [`AGENTS.md`](../AGENTS.md) — agent-operator manual.
- [`skills/producer-author/SKILL.md`](../skills/producer-author/SKILL.md) — the same content as this doc, in Anthropic Agent Skills format.
- [`docs/02-spec.md`](02-spec.md), [`docs/04-renderer.md`](04-renderer.md), [`docs/05-mock-producer.md`](05-mock-producer.md), [`docs/11-historic-data-sources.md`](11-historic-data-sources.md), [`docs/31-commentary.md`](31-commentary.md) — adjacent design pack docs.
- [`packages/spec/src/index.ts`](../packages/spec/src/index.ts) — the authoritative wire-protocol types.
- [`packages/plugin-sdk/src/index.ts`](../packages/plugin-sdk/src/index.ts) — `IngestPlugin`, `OddsSourcePlugin`, `CommentaryPlugin` interfaces.
- [`examples/hello-producer/`](../examples/hello-producer/) — 200-line working reference.
- [`apps/statsbomb-replay/`](../apps/statsbomb-replay/) — Python reference for replay producers.
- [`apps/mock-producer/`](../apps/mock-producer/) — Node reference for live-shape producers.

## RFC backlog

The five auxiliary streams (audio, odds-live, playerstats,
challenges, chat) are not all v1 spec-stable. The maturity right
now:

| Stream | Status | What's needed |
| --- | --- | --- |
| Primary match | Stable | nothing |
| Audio commentary | Stabilising | pin chunked-URLs vs live-binary on one canonical message header |
| Live odds | Stable shape, RFC WS surface | promote `OddsSample` to a top-level `Message` variant; today it's plugin-only |
| Player market stats | RFC | pin the heatmap key set, decide on per-player vs whole-team chunking, settle on cadence |
| Challenges / quizzes | RFC | pin the answer-submission auth contract, decide if challenges can be syndicate-scoped, finalise the points-payout schedule format |
| Leaderboard chat | RFC | decide moderation primitives, decide identity (handle vs anonymous), decide federation (Discord / Telegram / Matrix bridges) |

If you want to ship a producer against an RFC shape, open an
issue with label `spec-change` describing the producer and the
shape it needs. The orchestrator merges the spec change first;
the producer follows.

## License

CC-BY 4.0.
