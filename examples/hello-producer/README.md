# hello-producer

A 200-line Node script that emits a synthetic football match over
WebSocket in [`@tournamental/spec`](../../packages/spec/) format. Use
as the starting template for any real data producer: live tracking
feeds, video-CV pipelines, scraped APIs, manually-curated story
beats, audio commentary, live odds, leaderboard chat, in-match
quizzes, challenges.

## Run it

```bash
cd examples/hello-producer
pnpm install            # installs `ws`
pnpm start              # listens on ws://localhost:4001/
```

The renderer at `apps/web` (or any subscriber implementing the
spec) connects and starts receiving messages immediately.

## What it emits

The producer streams a complete `Message = MatchInit | StateFrame |
EventMessage` sequence:

1. **`match.init`** once on subscriber connect — teams, sport, field
   geometry, kickoff metadata.
2. **`state`** frames at 30 Hz — ball + 22 player positions, velocity,
   animation tag, game clock.
3. **Event messages** at human-relevant moments —
   `event.kickoff`, `event.goal`, `event.shot`, `event.foul`,
   `event.score_change`, `event.match_end`.

This is exactly what `apps/web/lib/renderer/` is built to consume.
Plug your live producer into the same WebSocket port and your
data renders in 3D on `play.tournamental.com/match/<your-match-id>`.

## What to change

For a real producer:

1. **Replace `tick()` in `src/index.mjs`** with your data source.
   The function returns a `StateFrame` and zero-or-more
   `EventMessage`s. Read from a kafka topic, a Twitch chat, a
   computer-vision pipeline (see `docs/06-video-cv.md`), a
   Google Sheet, a manual JSON file you update at half-time, an
   ElevenLabs WebSocket commentary stream.

2. **Adjust `MATCH_INIT`** for your match. The
   [`MatchInit`](../../packages/spec/src/index.ts) type tells you
   what fields the renderer needs.

3. **Honour back-pressure** if you push faster than the subscriber
   can read. The example does this trivially via `ws.send()`'s
   buffered-amount check; a high-volume producer should pause +
   resume.

## Stream the audio your producer narrates

To add a separate audio commentary track keyed to the same match,
emit your audio chunks on a **side channel** at
`ws://your-host/match/<match-id>/audio`. The renderer subscribes
both channels and feeds the audio mixer at
`apps/web/lib/audio/`. For pre-rendered MP3 batches see
`docs/31-commentary.md`; for live TTS, point the producer at the
ElevenLabs realtime WS and forward its binary frames unchanged.

See `docs/58-data-producers.md` for the audio-stream protocol
(work-in-progress; PRs welcome to extend the spec to make it
first-class).

## Submit your producer as a plugin

Once the producer works locally, the next step is to ship it as
a plugin so any Tournamental deployment can pick it up:

```bash
npm create @tournamental/app --template producer-ingest
```

That scaffolds a [`packages/plugins/<your-producer>/`](../../packages/plugins/)
directory with the `IngestPlugin` interface implemented, a passing
test, and a `plugin.json` manifest. Drop it in
`packages/plugins/`, open the PR, watch the reviewer agent's
checklist.

Merged producers join the
[Drips Network](https://www.drips.network) revenue split —
on-chain USDC continuously to your wallet for every dollar
Tournamental earns. See
[`docs/19-open-source-and-contributor-revenue.md`](../../docs/19-open-source-and-contributor-revenue.md).

## License

Apache 2.0.
