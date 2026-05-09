---
id: 0041
title: Suno-generated stadium ambience + goal stings
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P3
labels: [audio, atmosphere]
links:
  doc: docs/14-clip-generation-and-social.md
---

## What

Layer ambient stadium audio + crowd reactions over every match. Pre-generate the audio bed via Suno (or a comparable model), cache permanently, and play in the renderer with HTMLAudio elements.

Three tracks per match:
1. **Bed** — ~90 minutes of stadium ambience (crowd murmur + occasional chants), looped if needed. Lowered when commentary plays.
2. **Build-up** — short rising-tension cue triggered when the ball enters either penalty area.
3. **Goal sting** — celebratory cue triggered on `event.goal`.

Plus: a 30-second branded **trailer track** for the marketing site demo clip.

## Why

Per Tim's review 2026-05-09: "a little bit of music by suno.com as well." Crowd ambience makes the demo feel like a real broadcast and not a tech demo — disproportionately big perceived-quality lift for ~$0.

## Acceptance

- [ ] Suno API key obtained (Tim).
- [ ] One bed track per tournament, ≤ 5 MB compressed.
- [ ] One build-up cue (~3s) and one goal sting (~5s) per team kit family (we don't need 32; share across colour palettes).
- [ ] Renderer ducks bed under commentary by 12dB, restores after.
- [ ] Music + commentary mute toggle in the HUD.
- [ ] All audio files served from `apps/web/public/audio/` with `Cache-Control: public, max-age=31536000, immutable`.

## Notes

- Suno's official API is currently invitation-only / via partner programs; a wrapper like `suno-api` (community) exists but is fragile. Alternative: AIVA, Mubert, ElevenLabs Music. Pick one per cost and licensing terms.
- This is presentation polish, not v0.1-blocking.
