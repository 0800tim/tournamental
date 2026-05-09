# @vtorn/commentary

> Pure-function event-to-text commentary generator + a tiny scheduler that prevents the voiceover from talking over itself during scrambles.

## Why this is a package

Audio-rendering is the renderer's job (browser SpeechSynthesis or HTML `<audio>` against an ElevenLabs MP3 URL). What's *shared* is the deterministic mapping from `EventMessage` → spoken text + the timing rules that decide when a line plays. That's what lives here.

## Usage

```ts
import { generateCommentary, CommentaryScheduler } from "@vtorn/commentary";

const scheduler = new CommentaryScheduler({ channelCooldownMs: 600 });

// On every incoming spec event:
function onEvent(ev: EventMessage) {
  const lines = generateCommentary(ev, {
    players,    // Map<player_id, Player & { team_id }>
    teams,      // Map<team_id, Team>
    score,      // { [team_id]: number }
    minute,     // current cumulative minute
    enthusiastic: true,
  });
  scheduler.add(lines, ev.t);
}

// Once per render frame:
function onFrame(t_ms: number) {
  for (const line of scheduler.tick(t_ms)) {
    audio.play(line);            // browser SpeechSynthesis or ElevenLabs MP3
    hud.showTicker(line);        // mirrors the audio line in the HUD
  }
}
```

## What the package does NOT do

- **Synthesise audio.** The renderer picks a backend per `apps/api/src/routes/commentary.ts` (the ElevenLabs proxy ships there).
- **Cache audio files.** That's the API's responsibility (per-text URL → durable storage in R2/S3).
- **Speak in any language other than English.** v0.1 ships en-NZ defaults; localisation is doc 23 follow-up.

## Testing

```
pnpm -F @vtorn/commentary test
pnpm -F @vtorn/commentary typecheck
```

10 vitest tests cover the spec-event surface (kickoff, period_start/end, shot, save, goal, score_change, foul, substitution, penalty_shootout_start, penalty_attempt, penalty_shootout_end), determinism, and scheduler cooldowns.

## TTS backends

| Backend                        | Cost                | Notes                                                       |
| ------------------------------ | ------------------- | ----------------------------------------------------------- |
| `SpeechSynthesisAPI` (browser) | Free                | Default. Voice quality varies by OS.                        |
| ElevenLabs                     | ~$0.18 / 1k chars   | Premium voices. Proxied through `apps/api` `/v1/commentary/tts` so the API key never leaves the server. |
| Coqui XTTS-v2 (self-hosted)    | Compute only        | Phase 2 if ElevenLabs costs become material.                |

The proxy caches synth results to disk (or R2 when configured) keyed on `(voice, text_hash)`, so the second viewer of the same match downloads pre-baked MP3s.
