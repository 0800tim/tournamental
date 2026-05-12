# __PKG_DISPLAY__

A producer plugin for Tournamental, scaffolded from
`@tournamental/create-app`.

A producer streams **spec-conformant match messages** from any data
source into the Tournamental pipeline: a tracking feed, a video-CV
pipeline, a paid stats API, a manually-curated story-beat file, an
ElevenLabs commentary track.

## What this does today

Emits a `match.init` then `state` frames at 30 Hz with a static
ball and no players. That is intentionally the minimum the SDK
contract requires — the point of the template is to be a working
starting place, not a useful producer.

## What to edit

1. **`src/index.ts`'s `tick()` function** — that's where your real
   data source goes. Return a spec-conformant `StateFrame` per
   tick.
2. **Add event emission.** When something happens in your source
   data (a goal, a foul, a substitution), push an `EventMessage`
   to the subscriber. See
   [`@tournamental/spec`](https://www.npmjs.com/package/@tournamental/spec)
   for the full event-type union.
3. **`listAvailableMatches()`** — for replay-style producers
   (StatsBomb, recorded matches), return your static catalogue.
   Live feeds keep it empty and let the operator pass the
   `match_id` at start.
4. **`plugin.json`** — fill in your name + repo URL + (optionally)
   a `dripsListRef` to opt into the contributor revenue split.

## Running locally

```bash
pnpm install
pnpm test            # 1 test, asserts match.init shape
pnpm typecheck
```

## Hand-off to the stream server

When the plugin lands in the Tournamental repo, the stream server
at
[`apps/stream-server`](https://github.com/0800tim/tournamental/tree/main/apps/stream-server)
auto-registers your producer's `id` and exposes it on its admin
endpoint. An operator picks your producer per match.

## Auxiliary streams

For commentary audio, live odds, leaderboard chat, in-match
quizzes, challenges — see
[`docs/58-data-producers.md`](https://github.com/0800tim/tournamental/blob/main/docs/58-data-producers.md).
Each of those is a separate WebSocket on a side channel, so this
producer plugin stays focused on the primary match stream.

## Submitting

Open a PR placing this plugin at `packages/plugins/__PKG_SLUG__/`
with the label `skill: producer`. The reviewer agent runs the
producer-plugin checklist (spec-conformance, back-pressure,
no-PII, idempotent restart).

## License

Apache 2.0 (inherited from the template).
