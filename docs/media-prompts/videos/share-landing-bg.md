# Video — /s/[slug] share landing backdrop

**Where**: looped video element above the dateline + Fraunces headline
on the syndicate share landing page. This is the most viral surface
(every share lands here), so a small piece of restrained motion gives
it cinematic weight without committing to a literal "watch this video"
moment.

## Prompt — Grok Imagine

```
A locked-off cinematic shot: a single thin column of warm gold light cuts across the centre of a dim empty football pitch at twilight. The light pulses very slowly — a slow breathing dim-to-bright-to-dim across 5 seconds. The grass is dark forest green almost charcoal. Atmospheric haze drifts almost imperceptibly. No people, no ball, no markings. The camera is completely still. 5 seconds, seamlessly loopable. Editorial cinema aesthetic, restrained, atmospheric. Slight film grain.
```

## Alternative — the dusk shift

```
A locked-off cinematic shot: empty stadium seats viewed from a low angle, with the sky overhead slowly transitioning from deep charcoal to faintly warmer charcoal — a near-imperceptible dusk shift. A single warm gold floodlight glows steadily in the upper-right. No people, no movement otherwise. The camera is still. 5 seconds, seamlessly loopable. Editorial cinema aesthetic.
```

## Treatment in code

- Save as `apps/web/public/media/share-loop.mp4` + `.webm`.
- Render at ~15% opacity behind the editorial header. Lower than the
  hero on purpose — the headline and Fraunces dateline must dominate
  this surface above all else (share-card visitors land here first).
- 5 seconds is the minimum, but a *true* loop matters more than length;
  if it visibly cuts at the loop point, regenerate.

## DO NOT generate

- Anything that moves laterally (camera or subject) — kills the loop.
- A scoreboard.
- A trophy / podium / celebration.
- Bright stadium lights blazing.
