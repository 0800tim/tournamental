# Prompt: Commentary Extractor

> Used by the video-ingest pipeline. Sent to an LLM (Claude Sonnet, GPT-4o, or even a smaller model) once per second of game time. Merges the most recent transcript and frame description into spec event messages, plus a rephrased commentary line. Token budget: ~1,500 in / 300 out per call.

## System prompt

```
You are an event extractor for a sports broadcast pipeline. You receive:

  - The match scene description from a vision model for the current frame.
  - The Whisper transcript of the last ~2 seconds of commentary.
  - A short list of recent events already emitted (so you don't double-emit).

Your job is to output zero or more JSON event messages conforming to the
SimulatedSports v0.1 spec, plus an optional rephrased commentary line.

Rules:
- Output a single JSON object: { "events": [<EventMessage>, ...] }.
- "events" may be empty if nothing new and noteworthy happened.
- Be CONSERVATIVE. Do not emit a goal unless either the transcript or
  the frame description shows a goal celebration / scoreboard change.
- Use the player and team IDs from the lineup map provided in the user
  message. Never invent IDs.
- Always emit an event.commentary if the transcript window has any
  speech. Rephrase the commentary in your own words; never copy the
  transcript verbatim. Keep voice_id consistent across calls (provided).
- Use the t_ms from the frame description as the timestamp.
- Do not emit an event if the same event of the same type and same actor
  appears in the recent_events array within the last 3000 ms.
```

## User message template

```
=== Match context ===
spec_version: 0.1.0
match_id: {match_id}
team[0] (home): {team0.short_name} ({team0.id})
team[1] (away): {team1.short_name} ({team1.id})

=== Lineup map ===
{compact list: "BLU_9 -> S. Triker (#9)" etc, both rosters}

=== Frame description (vision model output) ===
{json from frame-analyzer.md}

=== Transcript window (last 2 seconds) ===
{whisper text, may be empty}

=== Recent events (last 5 seconds) ===
{compact list of last 5–10 events}

=== Voice config ===
default_voice_id: 11labs:adam
goal_voice_id: 11labs:adam_excited
```

## Output schema

```json
{
  "events": [
    { "type": "event.pass",       "t": 754000, "from": "BLU_11", "to": "BLU_8", "target": [25, -2], "success": true },
    { "type": "event.commentary", "t": 754000, "text": "Number eleven gets it forward — finds the holding mid in space.", "voice_id": "11labs:adam" }
  ]
}
```

## Worked example

**Input frame description**: open play, Blue 11 dribbling down the right at xy ≈ (22, -8.5) with high confidence ball.

**Transcript window**: "...and that's a beautiful run from the left winger, gets past the full back, looks for support..."

**Recent events**: `event.pass` from `BLU_8` to `BLU_11` 1.8s ago.

**Output**:

```json
{
  "events": [
    {
      "type": "event.commentary",
      "t": 754000,
      "text": "Eleven turns past the right back with ease, glances up looking for an option.",
      "voice_id": "11labs:adam"
    }
  ]
}
```

(No `event.pass` emitted — there was no new pass since the last one. No `event.tackle` emitted — the frame and transcript both indicate the dribble succeeded.)

## Conservatism heuristics

The extractor errs on the side of silence. Specifically:

- **Goal**: emit only if (a) frame's `scoreboard.home` or `scoreboard.away` differs from the last known score *or* (b) transcript contains an unambiguous "goal!" / "scores!" with player attribution *or* (c) frame's `scene_phase == "restart_after_goal"`.
- **Foul / yellow card / red card**: only on transcript "yellow", "red", "booked", "free kick" *and* a frame showing a stationary ball or referee involvement.
- **Pass**: only when ball moved between two clearly identified team-mates of the same team in adjacent vision frames. Otherwise let the renderer's animation FSM handle the running-with-ball case.
- **Shot**: emit when the ball trajectory crosses the final third toward goal at high speed, or when transcript contains "shoots", "strikes", "fires".
- **Substitution**: only on transcript "coming on for" / "off comes" / "substituted", or scoreboard ticker explicitly showing it.

## Failure modes

- LLM emits an event for a player who is not in the lineup map. The producer should validate against the lineup and drop unknown IDs.
- LLM emits two `event.goal` for the same goal in successive ticks. Mitigated by the recent_events dedup window. Producer also enforces "score can only increase by 1 per goal event" at the validation layer.
- LLM rephrases commentary too closely to the original. The producer can run a similarity check (cosine on small embeddings) and re-prompt if `> 0.85` similarity to source.
- LLM fabricates plausible-but-wrong narrative. This is the residual risk of using an LLM here. Honest framing in the producer field of MatchInit (`producer: "video-ingest-v0.x"`) signals to consumers that it's approximate.
