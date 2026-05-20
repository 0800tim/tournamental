# Hero — tournamental.com/ (marketing homepage)

**Where**: `apps/marketing/src/components/Hero.astro`, behind the
"Can you call every match of the World Cup?" headline. The image sits
under the hero section at low opacity (10-20%) with a charcoal gradient
overlay; the headline overlays.

**Why this image**: the hero is an editorial section front, not a sales
landing. The backdrop should evoke anticipation on the eve of a major
tournament, not "buy now" energy.

## Prompt

```
A wide, atmospheric photograph: empty football stadium at dusk, lights just switching on, top-down low angle. The pitch is dark forest green almost charcoal; floodlights wash the grass in a faint warm gold. No crowd, no players, no scoreboard. Drifting fog at pitch level. Editorial sport photography, shot on a 35mm prime, deep negative space top-right where text will overlay. Long exposure feel, slight grain. Charcoal palette with gold lighting accents only. The Athletic / New York Times sports section aesthetic. --ar 16:9 --style raw --stylize 150 --v 6.1
```

## Mobile portrait variant

```
A vertical, atmospheric photograph: empty football stadium at dusk, lights just switching on, low angle looking down the touchline toward an empty goal. Pitch dark forest green almost charcoal; floodlights wash the grass in faint warm gold. No crowd, no players, no scoreboard. Drifting fog at pitch level. Editorial sport photography, shot on a 35mm prime, deep negative space top half for headline overlay. Long exposure feel, slight grain. Charcoal palette with gold lighting accents only. The Athletic / New York Times sports section aesthetic. --ar 9:16 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/marketing/public/media/hero-home.jpg` (desktop) and
  `apps/marketing/public/media/hero-home-mobile.jpg`.
- Render at ~16% opacity behind the hero via CSS
  `background-blend-mode: luminosity` with a charcoal `#15151a`
  underlay. Don't let it hit 100% opacity — the headline must be the
  visual anchor.
- `object-position: top` so the deep-negative-space area lines up with
  the headline copy.

## DO NOT generate

- Players, mascots, referees.
- Branded kit colours or FIFA marks.
- Bright Sky Sports-style stadium glow.
- 3D-rendered balls.
- Confetti, fireworks, fans in stands.
