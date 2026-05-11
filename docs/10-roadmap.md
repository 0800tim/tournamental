# 10, Roadmap

> Concrete weekend plan and what to do after. Aggressive but realistic if multiple code agents run in parallel.

## v0.1, "Watchable mock match in the browser"

**Goal**: open a localhost URL, see two teams of stylized avatars playing a 90-min synthetic match with score updates and commentary in the HUD.

**Scope**: agents A–E + minimal H (procedural avatars only; the body GLB + animations).

**Acceptance**: a Twitter-postable 30-second screen recording showing the demo. Project README explains how to clone and run in two commands.

### Weekend day 1

Morning:
- Agent A: spec is already frozen, sanity check, bump to `0.1.0`, no other changes.
- Agent B: mock-producer skeleton, possession FSM, emits state at 10Hz. WebSocket output.
- Agent E: spec-client skeleton, `useMatchStream(ws://...)` returns store with `init/prev/curr/events`.
- Agent D: Next.js scaffolding, `<Canvas>`, procedural pitch, 22 player markers (cubes for now).

Afternoon:
- Agent B: pass model, shot model, goal scoring, kickoff restart, commentary templates.
- Agent D: real player avatars (procedural body + jersey texture + billboard face), animation FSM, camera rig, HUD with score/clock/commentary ticker.

End of day 1: ugly but watchable. Avatars move, ball moves, score updates, commentary appears.

### Weekend day 2

Morning:
- Agent H: replace cube placeholders with the real body GLB; wire up Mixamo animation set; jersey textures look right.
- Agent C: stream-server with Postgres, chunk writer, manifest. Pipe mock-producer through it; renderer reads from chunks instead of direct WS.

Afternoon:
- Agent G: Cloudflare in front of stream-server. Verify cache hit on chunks.
- Agent I: landing page, `/match/demo` always-on, OG images.
- Polish pass on D: smooth interpolation, camera modes, HUD typography.

End of day 2: shareable. Open the public URL, see a match, it looks intentional rather than experimental.

## v0.2, "Real video in, recap out"

**Goal**: feed a 2-minute clip of a real match (e.g. the YouTube clip Tim referenced) through the video-ingest pipeline and watch the rendered approximation.

**Scope**: agent F end to end. Iterate on prompts. Add `event.commentary` ElevenLabs TTS playback in the renderer.

**Acceptance**: a side-by-side video, original on the left, rendered on the right, where major events line up in time and the rendered match is recognisable as the same game (correct possession majority, correct final score on the HUD).

Time estimate: a focused week, with most of that time spent iterating on prompts and synthesis heuristics rather than infrastructure.

## v0.3, "Forks and worlds"

**Goal**: prove the framework story. Ship 2–3 alternate worlds:

- **Tabletop miniatures**, players are tiny clay-style figurines on a fabric pitch with stitched lines.
- **Low-poly fox league**, players are cartoon foxes; only animal mascots, no human likenesses.
- **Tactical-board**, top-down ortho, players as numbered discs with trails, ball as a glowing dot. Aimed at analysts.

Each world is a fork of the renderer with the spec-client untouched and `apps/web/public/models/*` swapped out. Document the fork process in `docs/`. Submit one of the three as a PR back to a `worlds/` collection in the main repo.

**Acceptance**: a third party (anyone but the original authors) ships a working fork by following the docs alone.

## v0.4, "Real tracking data"

**Goal**: integrate one live tracking feed end-to-end. Likely candidates: an open soccer dataset (StatsBomb open data has historical, no live), or a paid trial of a live provider, or an experiment with home-grown RFID/optical tracking on a local amateur game.

**Scope**: agent F variant, a `feed-adapter/` with provider-specific drivers behind a uniform interface.

**Acceptance**: rendering a match driven by real tracking data with the same renderer and CDN path. Side-by-side with the same match's video shows accurate player positions.

## v0.5+, Stretch

- **Native iOS / Android clients** using the same spec, possibly via Unity WebGL or React Native + react-native-webgl. The CDN already serves them; only the renderer changes.
- **VR mode**, WebXR, scene is already in three.js so this is mostly a camera-rig and locomotion change.
- **Multi-feed fusion**, merge an official tracking feed with a commentary STT producer for the talking-head experience over accurate motion.
- **Replay tools**, seek by event ("show me every shot in this match"), tactical analysis ("Blue's average defensive line"), shareable clips.
- **Live editor**, a producer that's a person typing events into a CLI, for streaming a Sunday-league match without any AI or tracking.

## What we explicitly are not building

- A commercial product.
- A subscription.
- A login system, accounts, or user-generated content moderation.
- A native mobile app *first*, the browser renderer covers iOS/Android via Safari/Chrome with no app store review.
- A service that competes with licensed broadcasters. The framework can be pointed at any source; the operator is responsible for what they do with it.

## When to declare victory

The project is "done enough" when a stranger on the internet can:

1. Find the repo.
2. Read the README in 5 minutes.
3. Run `pnpm install && pnpm demo` in another 5 minutes.
4. See a watchable match in their browser.
5. Fork it and ship their own world by next weekend.

That's the entire point.
