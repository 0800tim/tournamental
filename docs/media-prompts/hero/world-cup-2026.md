# Hero — tournamental.com/world-cup-2026

**Where**: top of the dedicated World Cup landing page on the marketing
site. Behind "World Cup 2026 · 48 teams · 104 matches" copy. Larger
canvas than the home hero, can carry a more cinematic image.

## Prompt

```
A wide cinematic photograph: dark night sky over an empty silhouette of a generic large football stadium, viewed from a quarter-mile away across an empty car park. The stadium glows faintly gold from inside, only the rim of the roof catching light. No crowd outside, no traffic, no signs, no brand markers. Atmospheric haze in the air. Deep charcoal sky with a single gold horizon line where the stadium light leaks. Editorial, restrained, anticipatory. Long exposure feel, slight film grain. The Athletic / Esquire long-form aesthetic. --ar 16:9 --style raw --stylize 150 --v 6.1
```

## Mobile portrait variant

```
A vertical cinematic photograph: dark night sky over an empty silhouette of a generic large football stadium, viewed from low across an empty car park. The stadium glows faintly gold from inside; only the rim of the roof catches light. No crowd outside, no traffic, no signs. Atmospheric haze. Deep charcoal sky, single gold horizon line. Editorial, restrained, anticipatory. Slight film grain. --ar 9:16 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/marketing/public/media/hero-wc2026.jpg` +
  `apps/marketing/public/media/hero-wc2026-mobile.jpg`.
- Render at ~25% opacity (this page can take a slightly more present
  backdrop than the home hero because the headline is heavier).
- Pair with a faint gold horizontal hairline drawn in CSS at the same
  vertical position as the stadium glow.

## DO NOT generate

- A recognisable stadium (don't invite trademark grief).
- "World Cup" stylised typography or trophies in the image.
- Pyrotechnics, fireworks, celebrating crowds.
- US/Canada/Mexico flag iconography (we deliberately dropped the host-country naming).
