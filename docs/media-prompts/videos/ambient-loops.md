# Video — ambient section loops

**Where**: small ambient motion loops embedded in mid-page sections
where the editorial copy could use a beat of life. Use sparingly —
one ambient loop per page maximum, max 5-second duration, max
~500 KB transcoded.

Three ambient prompts; pick the one that fits the section's tone.

## Prompt — the grass breath

```
A close-up locked-off shot: blades of dark dewy grass in extreme close-up, faint warm gold light just rim-catching the tips. The dew slowly catches and refracts the light as the camera holds completely still. No wind, no movement otherwise. 4 seconds, seamlessly loopable. Almost monochromatic — charcoal with gold accents. Macro photography aesthetic.
```

## Prompt — the lattice trace

```
A locked-off shot: an abstract gold lattice line slowly traces the outline of a soccer-ball pentagon panel against pure black — drawn in 4 seconds, fading out, looping back to the start. Geometric, restrained, like an architectural drawing animation. No texture, no shading other than the line itself. Editorial motion design aesthetic.
```

## Prompt — the floodlight warm-up

```
A locked-off cinematic shot: a single tall stadium floodlight tower silhouetted against deep charcoal sky. The lights at the top slowly warm from cold dim to faint warm gold over 4 seconds, then loop. The tower is in silhouette only; no detail. Atmospheric haze in the lower frame. No other movement. 4 seconds, seamlessly loopable. Editorial cinema aesthetic.
```

## Treatment in code

- Save as `apps/marketing/public/media/ambient-{grass,lattice,floodlight}.mp4`.
- Embed at most one per page, max 320px wide on desktop and 200px on
  mobile. The ambient loop is decoration, not a hero element.
- Position thoughtfully: alongside a story or principle column, never
  centred behind content.
- Same `prefers-reduced-motion` swap to a poster image.

## DO NOT generate

- Camera moves.
- Anything more than one motion vector at a time (the dew, OR the
  line, OR the lights — never two at once).
- Coloured lighting beyond the gold accent.
- Audio. These are silent decorations.
