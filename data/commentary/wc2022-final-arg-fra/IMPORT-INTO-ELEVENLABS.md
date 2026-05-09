# Importing the VTourn Commentary into ElevenLabs

All 10 languages now ready (en, es, pt, fr, de, it, zh, ar, ja, ru).
This guide walks you through rendering the 2965-line broadcast pack into
per-line MP3s for each of the ten languages, suitable for the renderer at
`apps/web/`.

## Recommended voice IDs per language

ElevenLabs' Multilingual v2 model handles all 9 non-English target languages
with the same English-trained voices, but cloned-from-target-language voices
generally give crisper pronunciation of player names and football idioms.
The voice IDs below are stable pre-made voices included free for any account
tier; for production you may also clone Tim's preferred narrator.

For browsing the latest free library, see https://elevenlabs.io/app/voice-library.
The IDs below are stable across the ElevenLabs default-voice set; cross-check
the "Voices" tab in the dashboard before render if a voice has been retired.

| Lang | Voice (Male)                       | Voice (Female)                     |
| ---- | ---------------------------------- | ---------------------------------- |
| en   | Adam (`pNInz6obpgDQGcFmaJgB`)      | Rachel (`21m00Tcm4TlvDq8ikWAM`)    |
| es   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| pt   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| fr   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| de   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| it   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| zh   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| ar   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| ja   | Adam (multilingual v2)             | Rachel (multilingual v2)           |
| ru   | Adam (multilingual v2)             | Rachel (multilingual v2)           |

**TODO (native-speaker voice IDs):** the table above uses Adam/Rachel via
multilingual-v2 as a known-good baseline for every language. For broadcast
quality, swap each language to a native-language clone or a hand-picked
voice from the public library (https://elevenlabs.io/app/voice-library).
Suggested filters per language:

- es - "Latin American Spanish" / "Argentine Spanish" / "broadcast"
- pt - "Brazilian Portuguese" / "broadcast"
- fr - "French (France)" / "sports broadcast"
- de - "German" / "broadcast" / "deep male"
- it - "Italian" / "sports broadcast"
- zh - "Mandarin" / "Standard / Mainland" / "news anchor"
- ar - "Modern Standard Arabic" / "broadcast" / "Al Jazeera-style"
- ja - "Japanese" / "broadcast" / "anime narrator" works for energy
- ru - "Russian" / "sports broadcast" / "deep male"

Update this table with the chosen voice IDs once Tim has previewed. The
voice ID format is a 20-char alphanumeric string visible in the URL when
viewing a voice in the dashboard.

## What you need

- ElevenLabs **Creator** tier or higher (you need ~163k characters per
  language; Creator gives you 100k/month so you may need to spread the work
  or upgrade to Pro for the initial render).
- A pre-cloned voice per language, or one voice you reuse with the language
  switch in the project settings.
- A scratch folder, e.g. `~/Downloads/vtourn-render/`.

## Recommended pipeline (one language at a time)

The most reliable workflow is to use the **ElevenLabs Studio Project**
import (Workspace → Studio → New Project) with the markdown chunks.

### 1. Set the project voice

Studio → New Project → pick the language → choose your VTourn narrator
voice. Set:

- Stability: 0.45 (broadcast-y, room for energy on goals)
- Similarity: 0.85
- Style exaggeration: 0.30

### 2. Paste lines in 100-line chunks

Studio's paste box accepts plain text. From the markdown file, use the
spoken text only (drop the `[Lxxxx · MM:SS · intent]` prefix for the paste
input, but keep it for filename mapping).

Quick chunk script:

```
awk 'BEGIN{n=0; c=0; out="chunk_001.txt"}
  /^\[L[0-9]+/{
    sub(/^\[[^]]+\] */, "")
    print > out
    c++
    if (c==100){ c=0; n++; out=sprintf("chunk_%03d.txt", n+1) }
  }' en.md
```

This produces `chunk_001.txt` ... `chunk_030.txt`. Paste each into Studio
in order, ensuring the voice and language are consistent.

### 3. Render and download

Studio renders all paragraphs to MP3 in one pass. Download the **single
project MP3** (you will split it next) OR use the per-paragraph download
endpoint via the Studio API for cleaner per-line MP3s.

### 4. Split into per-line MP3s

Each line is its own paragraph in Studio so per-paragraph timing markers
are available. Use the Studio API:

```
GET /v1/projects/{project_id}
GET /v1/projects/{project_id}/chapters/{chapter_id}/snapshots
```

The snapshots include `audio_offset` per paragraph. Slice the master MP3
on these boundaries with `ffmpeg`:

```
ffmpeg -i master.mp3 -ss <start> -t <duration> -c copy Lxxxx.mp3
```

A small helper is provided in this folder (TODO: `scripts/split-mp3.py`)
that reads `manifest.json`, the master MP3, and the Studio JSON to emit
per-line MP3s named `L0001.mp3` through `L2965.mp3`.

### 5. Drop into the renderer

Place the MP3s in:

```
apps/web/public/audio/commentary/{lang}/Lxxxx.mp3
```

The renderer reads `manifest.json` from the same folder and schedules
playback against the match clock cursor.

## Quality assurance loop

For each language, before committing audio:

1. Spot-check 10 random goal bursts and 10 random play-filler lines.
2. Listen to the full first 5 minutes plus the Messi penalty (22:24)
   plus the trophy lift sequence (~127:00).
3. Have a native speaker review the markdown text first (translation QA)
   then the rendered audio (pronunciation QA).
4. If a line sounds wrong, edit the markdown line, re-render JUST that
   paragraph in Studio, and replace the single Lxxxx.mp3.

## Cost monitoring

Each full language pack is ~163k characters. Watch your monthly quota:
Creator is 100k/month, so a single language exceeds it. Plan for either
Pro tier ($330/mo, 2M chars - covers all 10 languages with headroom) or
spread renders across two months on Creator.

## Recommended render order

1. **English** (master) - render first, full review by the team.
2. **Spanish** - Argentinian audience priority, sanity-checked by Tim's
   network.
3. **French** - for the French audience, similarly reviewed.
4. **Portuguese, Italian, German** - close European cousins, low review
   risk.
5. **Chinese, Japanese** - Asian distribution; review by native speaker
   needed especially for Mbappé/Messi pronunciation.
6. **Arabic, Russian** - last; render only after native review of the
   markdown.

## Troubleshooting

- **Emphasis on "GOAL!" feels flat**: Studio sometimes underplays caps.
  Try wrapping `<emphasis level="strong">GOAL!</emphasis>` SSML in just
  those paragraphs.
- **Player names mispronounced**: Pre-add a pronunciation dictionary in
  Studio (Workspace → Pronunciations) for: `Mbappé` (em-bap-AY),
  `Tchouaméni` (choo-am-EH-nee), `Di María` (dee-mah-REE-ah),
  `Otamendi` (oh-tah-MEN-dee).
- **Translation reads stilted**: Edit the markdown line directly, commit
  to git, re-render the single line.
