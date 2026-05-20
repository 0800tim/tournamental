# Hero — play.tournamental.com/s/[slug] (syndicate share landing)

**Where**: `apps/web/app/s/[guid]/page.tsx`, optional backdrop behind
the dateline + "Pool name" Fraunces headline. This page is the most
viral surface (every share lands here), so the imagery has to feel
inviting without telling the visitor *what* the pool is — the pool
name does that.

## Prompt

```
A wide atmospheric photograph: dim football pitch at twilight, viewed from a low angle in the stands, blurred out-of-focus silhouettes of stadium seats in foreground, sharp grass in midground. A single thin streak of warm gold light cuts across the empty pitch from one floodlight. No people, no ball, no markings. Mostly charcoal blacks with a single gold light source. Editorial, restrained, almost cinematic. Shot on a 35mm prime, slight film grain, long exposure feel. The Athletic story-opener aesthetic. --ar 16:9 --style raw --stylize 150 --v 6.1
```

## Vertical variant for share-card thumbnails

A square crop of the same scene, useful as a fallback share-thumbnail
when no syndicate-specific OG image is available:

```
A square atmospheric photograph: dim football pitch at twilight, viewed from a low angle, blurred out-of-focus silhouettes of stadium seats in foreground, sharp grass in midground. A single thin streak of warm gold light cuts across the empty pitch from one floodlight. No people, no ball, no markings. Mostly charcoal blacks with a single gold light source. Editorial, restrained, cinematic. Shot on a 35mm prime, slight film grain. --ar 1:1 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/web/public/media/hero-share.jpg` (16:9) and
  `apps/web/public/media/hero-share-1x1.jpg` (square).
- Render the 16:9 at ~15% opacity behind the editorial header; let the
  charcoal dominate so the dateline + Fraunces head stays the focal
  point.
- The 1:1 lives in `packages/social-cards/` as a fallback texture for
  social-card previews when a pool hasn't customised its hero.

## DO NOT generate

- A specific stadium (real or recognisable).
- Brand kit colours.
- Crowd silhouettes that look like specific countries (waving flags etc).
- Anything that looks like a final whistle or trophy lift moment.
