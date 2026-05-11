# 06, Video Ingest Pipeline (Video → Spec Stream)

> Watches a video stream and produces a spec-conformant JSON stream from it. Uses ffmpeg, Whisper, a vision LLM, and an event-extractor LLM. The output is approximate, not authoritative, but it's cheap, model-agnostic on the input side, and works on any source you can play.

## What this can and can't do

**Can:** identify discrete events ("a pass just happened", "ball entered the box", "goal celebration", "yellow card") with reasonable accuracy. Identify which team has possession. Approximate the ball's general region of the pitch. Drive a stylized recap-quality renderer.

**Cannot:** track all 22 players at 30Hz with metre-precise positions. That requires dedicated multi-object-tracking (MOT) computer vision, not a vision LLM. We position this pipeline as the *near-live recap* producer; an MOT-based producer is a separate project that follows the same spec.

If positional fidelity matters, you want optical or RFID tracking feeds and the [feed adapter](03-architecture.md#the-four-producer-types) producer.

## Stack

- **Python 3.11**, `apps/video-ingest/`. ML/CV is natural in Python.
- **ffmpeg** for frame and audio extraction.
- **faster-whisper** (CTranslate2 build of Whisper) for transcription. `medium` model fits in 6GB VRAM and is real-time on a single GPU.
- **Anthropic Claude Sonnet 4.5** for vision frame descriptions and event extraction. (GPT-4o is a drop-in alternative.)
- **Redis Streams** as the in-process queue between stages. Lets the pipeline tolerate stage stalls without losing input.
- **Postgres** for run logs, cost accounting, and spec output mirror.

## Pipeline

```
                       video source (file / RTMP / HLS / yt-dlp)
                                          │
                                          ▼
                        ┌─────────────────────────────────────┐
                        │ ffmpeg                              │
                        │   • frames @ 1 fps → frames/<t>.jpg │
                        │   • audio  @ 16kHz → audio chunks   │
                        └────────────┬────────────────────────┘
                                     │
                ┌────────────────────┼─────────────────────┐
                ▼                                          ▼
   ┌─────────────────────────┐               ┌──────────────────────────┐
   │ Whisper (rolling window)│               │ Vision LLM (per frame)   │
   │ → transcript_<t>.json   │               │ → frame_desc_<t>.json    │
   │   {start_ms,end_ms,text}│               │   {ball_region, players, │
   │                         │               │    actions, scoreboard}  │
   └────────────┬────────────┘               └────────────┬─────────────┘
                └─────────────┬──────────────────────────┘
                              ▼
                  ┌────────────────────────┐
                  │ Event extractor (LLM)  │     1Hz batched. Merges
                  │ → spec event(s)        │     transcript + frame desc
                  │ + plausible positions  │     into spec messages.
                  └───────────┬────────────┘
                              ▼
                  ┌────────────────────────┐
                  │ Spec emitter           │     ndjson over WS to the
                  │                        │     stream server.
                  └────────────────────────┘
```

## Stage detail

### 1. ffmpeg sampling

Extract frames at 1 fps (default; configurable up to 5 fps) and audio as 16kHz mono WAV chunks of 2s.

```bash
ffmpeg -i "$INPUT" \
  -vf "fps=1,scale=1280:-2" -q:v 4 -an   "frames/%07d.jpg" \
  -ar 16000 -ac 1 -f segment -segment_time 2 -f wav  "audio/%07d.wav"
```

Each frame's filename encodes its timestamp (`frame_index = timestamp_seconds`). ffmpeg writes both streams concurrently; the rest of the pipeline picks up files as they appear (Redis Streams entries published by an inotify-style watcher).

### 2. Whisper transcription

`faster-whisper` running with `medium.en` on GPU. Process audio chunks as they're written. Output normalized to:

```json
{ "t_ms": 12000, "duration_ms": 2000, "text": "...and Smith finds Jones on the right..." }
```

For multi-language matches use the multilingual model and a `language=` hint. Speaker diarization is *not* needed, we only care about the words.

### 3. Vision LLM frame description

For each sampled frame, call Claude with the `frame-analyzer` prompt (see [`prompts/frame-analyzer.md`](../prompts/frame-analyzer.md)). The model returns structured JSON:

```json
{
  "t_ms": 12000,
  "ball_region": "right_half_attacking_third",
  "ball_xy_estimate": [40.0, 18.0],
  "ball_confidence": 0.6,
  "possession_team": "blue",
  "scoreboard": { "blue": 1, "red": 0, "clock": "12:30" },
  "active_players": [
    { "team": "blue", "number": 11, "action": "running_with_ball", "xy_estimate": [40, 18] },
    { "team": "red",  "number": 2,  "action": "marking",            "xy_estimate": [42, 19] }
  ],
  "scene_phase": "open_play",
  "notable_events": ["winger_breaking_down_right"]
}
```

Cost-control techniques:

- Resize frames to 1280px on the long edge, vision LLMs don't benefit from more.
- One call per second of game time, not per video frame.
- For "boring" frames (no visible action change), use a previous-frame diff heuristic and skip.
- Cache frame descriptions by perceptual hash so re-runs of the same match cost nothing.

### 4. Event extraction

A second LLM call once per second, batching:
- The most recent frame description.
- The transcript window covering the last ~2 seconds.
- The previous 5 seconds of emitted events (for context, don't double-emit a goal).

Prompt: [`prompts/commentary-extractor.md`](../prompts/commentary-extractor.md). Model returns zero or more spec event messages plus an updated coarse position estimate for the ball and the active players.

The model is explicitly instructed to:
- Emit `event.commentary` for every transcript window with the rephrased commentary line and a `voice_id`.
- Emit `event.pass` / `event.shot` / `event.goal` etc. only when the *combination* of transcript and frame descriptions supports it.
- Be conservative: when in doubt, emit nothing rather than hallucinate.

### 5. State frame synthesis

The vision LLM's coarse `xy_estimate` for the ball and a few active players is sparse (~1Hz, several players missing). To produce a 10Hz state stream the renderer can lerp without seizing, a synthesis stage fills in:

- The full 22-player array each tick by copying their last known position and slowly drifting them toward formation defaults.
- Ball position interpolated between known estimates with simple constant-velocity assumption.
- `anim` set from the most recent action label (running, walking, idle).

This is unapologetically *fiction*, most of the players' positions are made up. The output looks plausible, supports the renderer, and is honestly labelled in the producer field of `MatchInit` (`"producer": "video-ingest-v0.3"`) so consumers know what they're getting.

### 6. Emit to stream server

NDJSON over WebSocket to the configured stream-server endpoint. Reconnect on failure with exponential backoff and local Redis-Streams replay buffer.

## Latency budget

End-to-end target: 8–15 seconds behind the source. Breakdown:

```
  source latency (HLS/RTMP):  4–8 s    (depends on source)
  ffmpeg processing:          ~0.2 s
  Whisper window:             2 s      (fixed)
  vision LLM call:            1–2 s
  event extractor LLM:        1–2 s
  network → stream server:    <0.2 s
  ────────────────────────────
  total:                      8–15 s
```

That's *worse* than a TV broadcast but *better* than most YouTube re-uploads. Acceptable for the framing.

## Cost model

For a 90-minute match at 1 fps vision sampling and 1Hz event extraction:

- 5,400 vision LLM calls × ~$0.005/call (Sonnet 4.5, ~1k tokens in / 200 out) ≈ **$27/match**.
- 5,400 event extractor calls × ~$0.003/call ≈ **$16/match**.
- Whisper: free (self-hosted).
- ffmpeg: free.

So **~$45 per match** for cold runs. With perceptual-hash caching across re-runs of the same source, repeat costs drop to near zero. Sub-sampling to 0.5 fps (one frame every 2 seconds) halves cost at the price of recall on fast events.

## Acceptance criteria

- [ ] Given a 90-min recorded match, produces a spec-valid stream end-to-end.
- [ ] Detects ≥80% of goals (high recall on the headline event).
- [ ] Score in `event.score_change` matches the actual final score.
- [ ] Commentary `event.commentary` lines play in time with the renderer's clock.
- [ ] Reproducible: same input + same prompts + same model = same output (modulo LLM nondeterminism, which we accept).

## What's out of scope (becomes follow-on producers)

- Per-player MOT tracking.
- Camera-pose estimation to back out world coordinates from broadcast view.
- Pose estimation for accurate kicking/heading animations.
- Multi-feed fusion (sideline cam + broadcast cam + tactical cam).

Each of these is its own producer in the same framework, sharing the spec. They can be developed independently and swapped in.
