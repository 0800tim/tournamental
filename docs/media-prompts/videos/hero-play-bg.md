# Video — play.tournamental.com hero backdrop

**Where**: looped video element behind the play app homepage hero.
Shorter and quieter than the marketing hero — this is a working app
surface, not a section front.

## Prompt — Grok Imagine

```
A locked-off cinematic shot: a single tournament football sits on dewy dark grass under a column of warm gold light. The dew on the grass shimmers very slowly. No movement otherwise — no rolling, no wind, no zoom. The camera is completely still. 5 seconds, seamlessly loopable. Almost monochromatic — charcoal grass with gold rim-light. Editorial cinema aesthetic, restrained, still-life. Slight film grain.
```

## Alternative — the breath

```
A locked-off cinematic shot: a single dark stadium banner hangs limp at twilight, the slightest breath of breeze ruffling its lower edge. No wording on the banner, no logo, no colour beyond the charcoal cloth. A single warm gold light from offscreen rims the top edge. 5 seconds, seamlessly loopable. Atmospheric, restrained. Slight film grain.
```

## Treatment in code

- Save as `apps/web/public/media/hero-play-loop.mp4` + `.webm`.
- Same `<video autoplay loop muted playsinline preload="metadata">`
  pattern; respect `prefers-reduced-motion`.
- Render at ~20% opacity over a charcoal underlay.
- Max 1.2 MB so the working app doesn't pay LCP cost.

## DO NOT generate

- Fast motion.
- Multiple balls / multiple objects.
- A goal celebration loop.
- A bracket UI shown inside the video.
