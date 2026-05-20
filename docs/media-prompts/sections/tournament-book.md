# Section — Tournament Book three-story strip

**Where**: `apps/marketing/src/components/TournamentBook.astro`, the
three-story trio on the marketing homepage ("The perfect bracket",
"On-chain settlement", "The global leaderboard"). One small image per
story so the strip reads as a magazine cover trio.

The images sit ABOVE each story head as 1:1 thumbnails (~120px on
desktop) framed with a hairline gold rule.

## Story 1 — The perfect bracket

```
A close-up macro photograph: a single bracket sheet drawn on graph paper in ballpoint pen, faint coffee ring stain in the corner, one cell circled in gold marker. The paper sits on dark wood under a single warm gold lamp. Shallow depth of field, slight film grain. Square crop. Editorial documentary aesthetic. Charcoal and gold palette. --ar 1:1 --style raw --stylize 150 --v 6.1
```

## Story 2 — On-chain settlement

```
A close-up macro photograph: a single wax seal in dark gold pressed onto a folded piece of dark charcoal paper, on a wooden surface. Warm gold lamp light from the upper left. The seal is intricate but not legible — a small lattice pattern. Square crop, shallow depth of field, slight film grain. Editorial documentary aesthetic. --ar 1:1 --style raw --stylize 150 --v 6.1
```

## Story 3 — The global leaderboard

```
A wide-aerial style macro photograph: faint pinpricks of warm gold light scattered across a dark surface, like distant city lights seen from a plane at night. The scatter is irregular, denser in some areas. No actual map shapes; just light points on charcoal. Square crop, slight film grain. Editorial documentary aesthetic. --ar 1:1 --style raw --stylize 150 --v 6.1
```

## Treatment in code

- Save as `apps/marketing/public/media/tb-1.jpg`, `tb-2.jpg`, `tb-3.jpg`.
- Render each as a 1:1 image, ~120px on desktop / ~80px on mobile,
  above the story index numeral. Wrap with a gold hairline rule
  beneath the image.

## DO NOT generate

- Literal bracket UIs (we have those in the app).
- Literal blockchain hexagon iconography.
- World map silhouettes (too on-the-nose).
- Photoshop sparkles or lens flare.
