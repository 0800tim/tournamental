# Section — tournamental.com/how-it-works (magazine longform)

**Where**: section dividers between the seven numbered steps in
`apps/marketing/src/pages/how-it-works.astro`. The page is a magazine
longform, so one small image every 2-3 sections sets visual rhythm
without overwhelming the type.

## Image 1 — "the prediction" (between step 2 and step 3)

```
A close-up overhead editorial photograph: a single A4 sheet of printed bracket grid on a dark wood table, half-completed in ballpoint pen. A coffee cup ring stain in the corner. A folded knee of a pair of dark jeans visible at the edge of the frame. Single warm gold lamp light from the upper left. No faces, no logos, no brand. Charcoal wood, gold light, off-white paper. Documentary editorial sport aesthetic, NYT Magazine cover spread feel. --ar 3:2 --style raw --stylize 150 --v 6.1
```

## Image 2 — "the wait" (between step 4 and step 5)

```
A close-up editorial photograph: a phone face-up on a dark table, screen dim and showing a single faint gold horizontal line (suggested bracket row, no UI legible). The phone is the only thing in focus; the surrounding table is shallow-DoF charcoal. A single gold lamp reflected on the screen's glass. No fingers, no hands, no faces. Restrained, anticipatory, almost still-life. Magazine cover-feature aesthetic. --ar 3:2 --style raw --stylize 150 --v 6.1
```

## Image 3 — "the result" (between step 6 and step 7)

```
A wide editorial photograph: empty football pitch viewed from the players' tunnel exit, dim and damp from rain, faint gold floodlight throwing long shadows down the corridor of the tunnel. Nobody in frame. Atmospheric, post-match stillness, restraint. Charcoal stadium concrete, single gold light source. Long exposure feel, slight grain. The Athletic story-closer aesthetic. --ar 3:2 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/marketing/public/media/how-it-works-{1,2,3}.jpg`.
- Inline at full content width with a one-line italic Fraunces caption
  underneath each ("Calls saved before kickoff are worth more.",
  "The wait is half the game.", "Results land. The IQ ladder updates.").
- Don't make them clickable; they are decoration, not navigation.

## DO NOT generate

- Animated bracket UIs rendered in the image.
- Football boots, balls in close-up (we have that for the play hero).
- Anyone in a kit.
- Glaring fluorescent stadium light.
