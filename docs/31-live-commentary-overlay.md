# 31, Live commentary overlay (user-selectable audio track)

> The user chooses what commentary they hear during a replay or live match. Default is our AI-generated, perfectly-synced ElevenLabs render. Optional: bring your own from an embedded YouTube stream, a live broadcast, or text-to-voice of a public commentary feed. The renderer's timeline is the master clock, every audio source synces back to it.

## Why this matters

- **Personalisation**, fans love the commentator they grew up with. Australians want SBS Les Murray-style; Brazilians want a Galvão-style scream-on-goal; Spanish-speakers want La Liga melodrama.
- **Localisation**, our pre-rendered ElevenLabs MP3s ship in 10 languages. But if a user wants to hear their actual broadcaster's Arabic feed, we let them.
- **Editorial credibility**, surfacing real broadcasters (where licence-permitted) makes us look less like a synthetic-only product.
- **Free dev path**, a YouTube embed of an unofficial fan reaction stream costs us nothing.

## The four commentary sources

| # | Source | Sync to renderer | Licence | Cost | Fidelity |
|---|---|---|---|---|---|
| 1 | **Tournamental AI commentary** (pre-rendered ElevenLabs MP3s) | Perfect (line-level `t_ms`) | Ours, clean | Server-rendered once, served from CDN | Excellent in 10 langs, recognisably AI |
| 2 | **Tournamental AI commentary** (live ElevenLabs WSS) | Perfect (live event-driven) | Ours, clean | Pay-as-you-go ElevenLabs Pro | Same as #1, but for live matches |
| 3 | **YouTube embed** (fan reaction / unofficial mirror stream) | User aligns once with a "tap to sync" gesture | Embed iframe; honour creator's allow-embed setting | Free | Variable; depends on streamer |
| 4 | **Official broadcaster audio** (link-out, geo-gated) | We don't host; user has the broadcaster app open in another window | Per-broadcaster licence; affiliate revenue per `docs/30` | Pay TV affiliate revenue ↑ | Native broadcast |

Default: **#1 (pre-rendered)** for replays. **#2 (live WSS)** for live matches once we have an active commentary feeder. **#3** as user-selectable. **#4** is editorial, we describe how to find it, with affiliate pay-tv link.

## UI surface

`<CommentaryPicker>` component in `apps/web/components/match/`:

```
┌─ Commentary ────────────────────────────────────┐
│ ◉ Tournamental AI (English) ▼                         │
│   ┐  English / Spanish / French / Portuguese /  │
│   │  German / Italian / Chinese / Arabic /      │
│   └  Japanese / Russian                         │
│ ○ YouTube fan stream, paste URL                │
│ ○ Mute (just crowd ambience)                    │
│ ○ Watch on broadcaster: [Sky NZ $14.99 →]      │
└──────────────────────────────────────────────────┘
```

Pickable from a small headphones icon in the renderer top-right. Persists per-user via localStorage.

## Sync mechanics

### Pre-rendered MP3s
- Manifest at `data/commentary/<match>/manifest.json` lists `Lxxxx + t_ms`.
- On scrub, find the nearest line via binary search, seek and play.
- 100ms crossfade on direction change.

### Live WSS
- Every event from the match producer triggers `text → ElevenLabs WSS → PCM → AudioContext`.
- Latency budget: < 250ms text-to-first-byte. ElevenLabs Turbo v2.5 hits this on EU/US edges.
- On goal events the audio mixer ducks crowd by -8dB so the commentary punches.

### YouTube embed
- User pastes a YouTube watch URL.
- We extract video id, mount `<YouTube>` (`react-youtube` package) at low opacity in a corner.
- "Tap to sync", user double-taps the moment in the YouTube stream that matches kickoff in our renderer; we record the offset and apply it.
- `mute` on our own audio while YouTube plays.
- This is a power-user feature; ship in Phase 4 of the live-stream feature.

### Broadcaster link-out
- Just a CTA. We don't try to host or sync the broadcaster audio (licensing).
- We DO show the broadcaster's pay-TV affiliate link with a "watching on Sky NZ?" copy.

## Data we need per match

```json
{
  "match_id": "...",
  "commentary": {
    "ai_pre_rendered": {
      "languages": ["en","es","fr","pt","de","it","zh","ar","ja","ru"],
      "manifest_url": "/audio/commentary/{match}/{lang}/manifest.json",
      "audio_base": "/audio/commentary/{match}/{lang}/"
    },
    "ai_live_wss": {
      "feeder_url": "wss://stream.tournamental.com/match/{match}/text",
      "elevenlabs_voice_ids_per_lang": { "en": "...", "es": "..." }
    },
    "youtube_embeds_known_to_work": [
      { "channel": "FreeFootballHighlightsCH", "url_template": "..." }
    ],
    "broadcaster_links": [
      { "country": "NZ", "broadcaster": "Sky NZ", "affiliate_url": "..." },
      { "country": "AU", "broadcaster": "Optus Sport", "affiliate_url": "..." }
    ]
  }
}
```

`apps/wc2026-data/scrape.py` extends to populate `commentary` per match where data is known.

## ElevenLabs render workflow

> Tim's question: should I get an API key, or use the manual ElevenLabs UI?

**Recommendation: get a Creator-tier API key now**, but you can also do the first language manually to QA the voice.

### Manual UI workflow (good for first-language QA)
1. Sign up at https://elevenlabs.io/app/voice-library, pick a voice.
2. Open ElevenLabs Studio → New Project → "Long form audio".
3. Paste `data/commentary/wc2022-final-arg-fra/en.md` in chunks of 100 lines.
4. Generate, listen, tweak voice settings (Stability, Similarity Boost, Style).
5. Export full MP3 (one big file ≈ 3 hours of audio).
6. Use `scripts/split-mp3.py` (TODO; we'll write it) to chop the long MP3 into per-line files keyed by `Lxxxx`.

### Programmatic API workflow (better for the other 9 langs)
1. Get API key from https://elevenlabs.io/app/settings/api-keys.
2. Add to `.env`: `ELEVENLABS_API_KEY=...`.
3. Per language: pick voice, run `scripts/render-commentary.mjs` which loops manifest, calls ElevenLabs `text-to-speech/{voice_id}` for each line, saves `Lxxxx.mp3` to `apps/web/public/audio/commentary/{lang}/`.
4. Total cost across 10 langs: ~$200-260 for one full render (or $330 for an unlimited month on Pro).

I recommend Pro tier for the rendering month so we can iterate without per-character anxiety.

### After rendering
- Upload the per-line MP3s to a CDN (Cloudflare R2 or just `apps/web/public/`). 2965 lines × 10 langs × ~20-50 KB each = ~6 GB total. Manageable.
- Hashed filenames + long Cache-Control header.
- The renderer fetches `Lxxxx.mp3` on-demand keyed by manifest.

## Live commentary streams to embed

We can't redistribute copyrighted broadcasts, but **fan-uploaded or open-licensed streams** can be embedded with permission. Some sources:

- **YouTube live**, many free-football channels stream public-domain footage with commentary. Search: `world cup 2026 live commentary` on YouTube during match days.
- **Twitch**, fan-reaction streamers (`!sport`, etc.). Embeddable.
- **BBC Sport live text**, public RSS / web. We can scrape and TTS-render it ourselves. Different licensing but text-only content reuse is generally fair.
- **Sofascore / Flashscore / Livescore**, text commentary feed, scrape → TTS option for users who want a "real-broadcast vibe" but in our voice.

For launch (11 June 2026), the **safe defaults** are:
1. Tournamental AI in 10 languages, guaranteed, owned, ready.
2. YouTube embed picker as a power-user feature, opt-in.
3. Broadcaster link-out as the affiliate CTA, pay-TV revenue.

Live unofficial streams (#3) we mention in the picker but don't actively promote, too volatile.

## Component sequencing

| Day | Task |
|---|---|
| 1 (now) | Pre-rendered EN MP3s, Tim's manual ElevenLabs Studio render OR API render of EN. |
| 2 | `scripts/split-mp3.py` if Tim used Studio long-form export. |
| 2 | `<CommentaryPicker>` component v0 with language switcher only. |
| 3 | Render the other 9 languages via programmatic API. |
| 3 | YouTube embed picker (manual sync). |
| 4 | Live WSS pipeline integrated with live event producer. |
| 5 | Broadcaster link-out + per-country affiliate matching. |

## Constraints

- We never host copyrighted broadcaster audio.
- We never decompile or proxy a broadcaster's stream.
- YouTube embeds use the official iframe API; we honour `allowEmbedding: false`.
- ElevenLabs ToS check: Pro tier permits commercial redistribution of generated audio. Verify on the day of API key purchase.

## Open questions for Tim

1. **ElevenLabs Pro tier**, recommend signing up tomorrow so we can render-test the EN voice within 24h. $33-330/month depending on usage tier.
2. **Voice selection**, recommend picking 1 male + 1 female voice per language (10 × 2 = 20 voices). Most are free in the ElevenLabs Voice Library. Want me to draft a recommendation list?
3. **Self-hosted MP3 vs CDN**, for 6 GB of audio, recommend Cloudflare R2 ($0.015/GB-month, free egress to Cloudflare). Cheaper than S3, fast, and we already use Cloudflare.
4. **YouTube fan streams**, are you OK with users embedding *anything* via paste-URL, or do we curate a whitelist?
