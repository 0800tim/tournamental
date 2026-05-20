# Video — tournamental.com hero backdrop

**Where**: looped video element behind the marketing homepage hero
copy. Replaces (or supplements) the still hero image. 5-8 seconds,
seamlessly loopable, autoplay + muted + playsinline.

## Prompt — Grok Imagine

```
A slow cinematic shot: empty football pitch at dusk, low fog drifting across the grass from left to right, faint warm gold stadium lights pulsing slowly on and off in the distance. No people, no players, no ball. Long exposure feel, slight film grain, almost monochromatic — charcoal grass with gold light accents. The camera is locked off, not moving. 6 seconds, loopable. Editorial cinema aesthetic, restrained, atmospheric. Mostly empty negative space top-right where text will overlay.
```

## Alternative — the pre-whistle hush

```
A slow cinematic shot looking down a dark empty stadium tunnel from inside, the rectangle of pitch and warm gold floodlight visible at the far end. Slight haze drifts toward camera. No movement otherwise. The camera is locked off. 6 seconds, loopable. Editorial cinema aesthetic, atmospheric, anticipatory. Charcoal concrete walls, gold light at the tunnel exit.
```

## Treatment in code

- Save as `apps/marketing/public/media/hero-loop.mp4` + `hero-loop.webm`.
- Pair with a still poster (use the still from `hero/marketing-home.md`)
  so the page renders something on first paint while the video preloads.
- `<video autoplay loop muted playsinline preload="metadata">` with a
  `prefers-reduced-motion: reduce` query that swaps to the still image.
- Render at ~25% opacity with a charcoal blend so the headline remains
  the focal point.
- Max file size 1.5 MB; transcode with `ffmpeg -vcodec libx264 -crf 28
  -preset slow -movflags +faststart` if it comes out larger.

## DO NOT generate

- Fast motion (anything that moves more than a slow drift kills the
  editorial restraint).
- Players running, ball flying, fan cheering.
- Camera moves (no dolly, no zoom, no pan). Locked off only.
- Bright colour explosions.
