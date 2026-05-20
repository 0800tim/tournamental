# Flourish — section divider

**Where**: any page that wants a visual break between editorial
sections. Best use: the marketing homepage between Hero and
TournamentBook, and between TournamentBook and the post-hero sections.

This is NOT a photograph. It's an abstract gold motif rendered against
charcoal, suitable to drop in as a thin decorative ribbon.

## Prompt — the lattice

```
A horizontal abstract motif: a single fine gold lattice line tracing the outline of a soccer-ball pentagon-hexagon panel, slowly fading at both ends into deep charcoal. The lattice is geometric, restrained, like an architectural drawing in gold ink on black paper. No noise, no texture, no shading other than the line itself. Wide ribbon aspect. The image is mostly empty charcoal with the motif occupying the centre quarter. --ar 5:1 --stylize 400 --weird 50 --v 6.1
```

## Prompt — the meridian

```
A horizontal abstract motif: a single fine gold latitude/longitude meridian line crossing a black sphere, suggested rather than drawn in full. The line is restrained, geometric, like a globe-engraving on black. Mostly negative space. The motif occupies the centre quarter; the ends fade into deep charcoal. Wide ribbon aspect. --ar 5:1 --stylize 400 --weird 50 --v 6.1
```

## Prompt — the arc

```
A horizontal abstract motif: a single gold arc, like the trajectory of a chipped football mid-flight, faint dotted continuation. The arc is restrained, geometric, like a physics-textbook diagram in gold on black. Mostly negative space. The motif occupies the centre. --ar 5:1 --stylize 400 --weird 50 --v 6.1
```

## Treatment in code

- Save as `apps/marketing/public/media/divider-{lattice,meridian,arc}.svg`
  (Midjourney exports as JPG; convert via image-to-SVG or just use
  the JPG with `mix-blend-mode: screen` on a charcoal surface).
- Use sparingly: max one per page. They are a beat, not a pattern.

## DO NOT generate

- Anything that looks like a "decorative banner" stock asset.
- Confetti, fireworks, particle effects.
- Filigree or "luxury brand" curlicues.
- 3D rendered objects.
