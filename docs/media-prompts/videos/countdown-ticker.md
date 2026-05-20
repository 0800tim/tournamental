# Video — countdown ticker

**Where**: Behind or alongside the existing `CountdownBanner` on the
play homepage and any "X days to kickoff" surface. Adds a beat of
ritual to what's otherwise a static number.

## Prompt — the ticking arc

```
A locked-off macro shot: a single thin gold needle rotates very slowly across the face of a dark clock-like dial — the needle moves about 10 degrees over 5 seconds, not a full revolution. The dial has no numbers, only faint gold marker dots at the four cardinal positions. Behind the dial, deep charcoal with a single warm gold light source upper-right. Editorial motion design aesthetic, restrained. 5 seconds, seamlessly loopable.
```

## Alternative — the tide

```
A locked-off cinematic shot: a single thin warm gold light slowly sweeps along a dark horizontal line — like a lighthouse beam but very contained, moving left-to-right across 5 seconds, then resetting. Mostly empty negative space above and below. Charcoal field with a single gold sweep. 5 seconds, seamlessly loopable. Editorial motion design aesthetic.
```

## Treatment in code

- Save as `apps/web/public/media/countdown-loop.mp4`.
- Pair with the existing `CountdownBanner` text overlay; the video
  sits behind the days/hours/minutes/seconds at ~30% opacity.
- Replace with a still poster under `prefers-reduced-motion`.

## DO NOT generate

- A literal clock face with hands moving.
- A digital countdown display.
- Any actual numbers in the video.
- Loud / colourful / chrome rendering.
