# 02 — JSON Stream Spec

> The contract that everything else hangs off. A producer that emits this stream and a renderer that consumes it can be authored independently and will interoperate. Canonical TypeScript types live in [`spec/types.ts`](../spec/types.ts).
>
> **Spec version: 0.1.1** (penalty shoot-out events added for the AR-FR 2022 demo per [doc 11](11-historic-data-sources.md)). Backward-compatible minor bump from 0.1.0; conformant renderers MUST ignore unknown event types and SHOULD therefore continue to play 0.1.1 streams without modification.

## Design goals

1. **Small surface.** Three message kinds (`match.init`, `state`, `event.*`). Anything more invites bikeshedding and fragmentation.
2. **Renderer-friendly.** Continuous positional state is separate from discrete events. The renderer interpolates state, fires animations on events.
3. **Producer-flexible.** The producer can be a mock generator, a video-and-LLM pipeline, an official tracking feed, or a person typing into a CLI. The stream looks the same.
4. **Stable identifiers.** Players are referenced by stable string IDs, never jersey numbers (which change on substitution).
5. **Versioned.** `match.init.spec_version` lets renderers decide whether to play or refuse a stream.
6. **Extension hatches.** `meta` on players, vendor-prefixed animation tags (`x_breakdance`), and the ability to add new `event.*` types without invalidating existing renderers.

## Coordinate system

Origin at pitch centre. The pitch lies in the XY plane; +z is height above ground.

```
            +y
             ▲
             │
   ┌─────────┼─────────┐  goal at +x defended by teams[1]
   │         │         │
   │         │         │
   │         O─────────┼─►  +x
   │         │         │
   │         │         │
   └─────────┼─────────┘  goal at -x defended by teams[0]
             │
```

Units default to metres. A producer that reports in feet must set `field.units = "ft"` and use feet consistently for *all* distances and velocities in the stream.

## Three message kinds

### `match.init` — sent once

The static scene. Field dimensions, both teams with full rosters, kit colours, and (optionally) URIs to per-player avatar assets. Emitted exactly once at the start of every stream. Late-joining clients receive it on connect.

```json
{
  "type": "match.init",
  "spec_version": "0.1.0",
  "match_id": "fc-anytown-vs-real-elsewhere-2026-05-09",
  "sport": "soccer",
  "field": { "length": 105, "width": 68, "units": "m", "surface": "grass" },
  "teams": [
    {
      "id": "FCA",
      "name": "FC Anytown",
      "short_name": "ANY",
      "kit": { "primary": "#0F2A6B", "secondary": "#FFFFFF" },
      "players": [
        {
          "id": "P_FCA_GK",
          "name": "G. Keeper",
          "number": 1,
          "position": "GK",
          "face_uri": "https://cdn.example/faces/fca_1.png"
        }
      ]
    },
    { "id": "REL", "name": "Real Elsewhere", "kit": { "primary": "#E63946", "secondary": "#1D3557" }, "players": [] }
  ],
  "start_time": "2026-05-09T19:45:00Z",
  "competition": "Show & Tell Cup",
  "producer": "mock-v1"
}
```

### `state` — sent continuously

Pure positional truth, emitted at 10–30 Hz. The renderer keeps the most recent two frames and lerps between them based on elapsed time. `t` is milliseconds since `match.init`.

```json
{
  "type": "state",
  "t": 12450,
  "ball": { "pos": [12.4, -3.1, 0.11], "vel": [4.2, 1.0, 0], "carrier": "P_FCA_LW" },
  "players": [
    { "id": "P_FCA_LW", "pos": [11.9, -3.2], "facing": 0.31, "anim": "sprint", "has_ball": true },
    { "id": "P_REL_RB", "pos": [13.8, -2.0], "facing": 3.10, "anim": "run" }
  ],
  "period": 1,
  "clock_display": "12:30"
}
```

`anim` is the *current* sustained animation tag — almost always one of `idle`, `walk`, `run`, `sprint`, `dribble`. One-shot animations like `kick`, `header`, `tackle`, `celebrate` are typically driven by an event (see below) rather than a sustained `anim` tag, though both are legal.

### `event.*` — sent irregularly

Discrete moments that drive animations, score updates, and HUD entries. Discriminated union, well typed.

```json
{ "type": "event.pass", "t": 12650, "from": "P_FCA_LW", "to": "P_FCA_CM", "target": [22.0, -10.0], "success": true }
{ "type": "event.shot", "t": 14820, "player": "P_FCA_ST", "target": [50.0, 0.5, 1.8], "on_target": true }
{ "type": "event.goal", "t": 14910, "player": "P_FCA_ST", "team": "FCA", "assist": "P_FCA_LW" }
{ "type": "event.score_change", "t": 14911, "home": 1, "away": 0 }
{ "type": "event.commentary", "t": 14920, "text": "And it's there! Anytown lead, 1–nil.", "voice_id": "11labs:bri" }
```

Renderer behaviour for canonical event types is specified in [`docs/04-renderer.md`](04-renderer.md).

## Wire format

The stream is a sequence of JSON objects, one per message. Two encodings are supported and clients SHOULD accept either:

- **NDJSON over WebSocket / SSE / chunked HTTP** — one JSON object per `\n`-terminated line. Default for live streams.
- **JSONL files at rest** — same encoding, written to disk for replay or CDN distribution. See [`docs/08-cdn-distribution.md`](08-cdn-distribution.md) for chunking strategy.

Compression: gzip is recommended at the transport/CDN layer. Per-message compression is not part of the spec.

## Versioning

`spec_version` follows semver. A renderer that sees a major-version mismatch SHOULD refuse the stream with a clear message; a minor-version mismatch is forward-compatible (renderer ignores unknown event types and unknown fields).

Producers MUST NOT silently change the meaning of a field within a major version. New animation tags are *additive* and unknown tags MUST fall back to `idle` on conformant renderers.

## What's deliberately not in the spec (yet)

- **Player rotations beyond yaw** (no pitch/roll). Adds animation rigging complexity for marginal gain at this scope.
- **Crowd, weather, atmosphere.** Renderer-side concerns, not stream concerns.
- **Replays / time travel.** A producer can emit a stream from arbitrary `t` and the renderer will play it; explicit replay control is a layer on top, not part of the wire format.
- **Multi-camera authoring.** Cameras are entirely a renderer concern.

If we discover any of these are load-bearing, they'll go in `v0.2`.

## Conformance test producer

A reference *deterministic* mock producer (a fixed seeded match) lives in `apps/mock-producer/` and is the test fixture every renderer should run against during development. See [`docs/05-mock-producer.md`](05-mock-producer.md).
