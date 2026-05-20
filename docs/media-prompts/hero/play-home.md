# Hero — play.tournamental.com/ (signed-in landing)

**Where**: `apps/web/app/page.tsx`, the play app's homepage. Backdrop
behind the "Predict every match" hero copy. Lower contrast than the
marketing hero because this surface is a working app, not a section
front — the image should set tone without competing with the CTAs.

## Prompt

```
A close-up macro photograph: a single tournament-grade football, matte leather, sitting still on dark dewy grass under a single column of warm gold light. The ball is slightly off-centre right, the rest of the frame is empty dark grass receding into shadow. No markings, no logo, no laces visible. Shot at f/2 on a 50mm prime, shallow depth of field, almost monochromatic — charcoal grass, gold rim-light. Editorial sport photography, long exposure stillness, slight film grain. The Athletic cover-story aesthetic. --ar 16:9 --style raw --stylize 150 --v 6.1
```

## Mobile portrait variant

```
A close-up macro photograph: a single tournament-grade football, matte leather, sitting still on dark dewy grass under a single column of warm gold light. The ball is centred in the lower third of the frame; the upper two thirds are empty dark grass receding into shadow for headline overlay. No markings, no logo, no laces visible. Shot at f/2 on a 50mm prime, shallow depth of field, almost monochromatic — charcoal grass, gold rim-light. Editorial sport photography, long exposure stillness, slight film grain. --ar 9:16 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/web/public/media/hero-play.jpg` + `hero-play-mobile.jpg`.
- Apply at ~22% opacity with a charcoal underlay; the upper two-thirds
  should be near-black so the headline still scores 7+ on contrast.
- Consider `background-attachment: fixed` for the desktop variant if
  the page is long enough — gives a subtle parallax feel without a JS
  scroll handler.

## DO NOT generate

- Multiple balls, juggling balls, balls in mid-air.
- Players' feet, boots, shin guards.
- Adidas-style branded balls with chrome panels.
- Stadium turf with painted lines (reads too literal).
