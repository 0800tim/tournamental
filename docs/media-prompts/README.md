# Media prompts

Paste-ready prompts for Midjourney (images) + Grok Imagine (short
videos) to scatter atmospheric media across `tournamental.com` and
`play.tournamental.com`. Built to match the editorial-sport direction
in [docs/BRAND.md](../BRAND.md): charcoal canvas, brand gold accents,
Fraunces editorial restraint.

## What's in here

| Folder | Use | Output medium |
|---|---|---|
| `hero/` | Backdrops behind the headline copy on hero sections | Midjourney still |
| `sections/` | Mid-page decorative imagery, magazine-style asides | Midjourney still |
| `flourishes/` | Small abstract motifs (section dividers, empty states, loading) | Midjourney still |
| `videos/` | Looping or short-clip atmospherics for hero + section backdrops | Grok Imagine |

Each file ships:
- Where to use it (route + element).
- Paste-ready prompt.
- Aspect ratio + render flags.
- Style notes + reference references where useful.
- A "DO NOT" list for the obvious wrong directions.

## How the imagery should feel

Reference points:
- *The Athletic* — high-contrast moody sports photography.
- *FT Sport* — editorial restraint.
- *NYT sports section longform* — illustrated occasional features.
- *Wes Anderson football* — but only as a structural reference, not aesthetic.

Aesthetic constraints to enforce in every prompt:

- **Palette**: charcoal `#15151a` dominant, brand gold `#dca94b` accents, off-white `#e6e6ea` highlights. Saturation low; gold is the only chromatic note.
- **Mood**: anticipation, ritual, twilight, scale, restraint. Not celebration, not chrome, not stock crowd-cheer.
- **Composition**: lots of negative space, off-centre subjects, atmospheric depth. Backdrop imagery should never compete with the headline typography that overlays it.
- **No people in close-up**. Crowds as silhouettes, players as long-shot silhouettes only. Avoids AI-perfect faces.
- **No FIFA marks**, no recognisable trophies, no real stadium names. Generic football, abstract enough.

## Aspect-ratio guide

| Use | Desktop | Mobile | Reasoning |
|---|---|---|---|
| Hero backdrop | 16:9 (`--ar 16:9`) | 9:16 (`--ar 9:16`) | Two outputs per hero so the same scene works on both |
| Section banner | 3:1 (`--ar 3:1`) | 4:5 | Thin landscape on desktop, taller on phones |
| Square decoration | 1:1 | 1:1 | Same on both |
| Section divider | 5:1 (`--ar 5:1`) | 5:1 | Ultra-thin ribbon, no crop drama |

## Render flags

Midjourney v6.1: append `--style raw --v 6.1` to most prompts. The
`--style raw` flag tells MJ to skip its default beautification pass,
which is essential — beautification is exactly what makes the
"AI-generated" tell. Reach for `--stylize 100` to `--stylize 250` for
more authored output; default 400-600 looks like a stock-photo crop.

For matte editorial photographic feel, add `--style raw --stylize 150`.

For abstract gold motifs, drop `--style raw` and use `--stylize 400 --weird 50` so MJ can play with form.

## How to use these

1. Pick the file matching the destination on the site.
2. Copy the prompt verbatim into Midjourney (or Grok Imagine for videos).
3. Generate 4 variants, pick the closest to the spec.
4. If using on the site, save the output to `apps/<app>/public/media/<slug>.jpg`
   (or `.mp4`/`.webm` for video). Reference from the relevant
   component. Cap image dimensions at 2400px wide so we don't bloat
   First Load.
5. Always run the result through a passing-glance test: would a sports
   editor in 1995 reach for this image as a section opener? If not,
   regenerate.

## Where the images go

Routes that should get hero imagery (in priority order):

1. `apps/marketing/src/components/Hero.astro` — top of `/`.
2. `apps/web/app/page.tsx` — top of play `/`.
3. `apps/web/app/s/[guid]/page.tsx` — share landing hero.
4. `apps/marketing/src/pages/world-cup-2026.astro` — kickoff page.
5. `apps/marketing/src/pages/syndicates.astro` — pool host pitch.
6. `apps/marketing/src/pages/how-it-works.astro` — magazine longform.

Section decorations and flourishes can land anywhere the editorial
flow has a transition or a quiet beat.

## DO NOT

- Stock-photo "team in huddle" or "fans high-fiving".
- Hyper-saturated football stadium glow shots.
- 3D-rendered Adidas-like balls with chrome reflections.
- AI-perfect celebrating faces.
- Any image showing FIFA logo, World Cup trophy, official kits.
- Bright colour gradients (we have one accent: gold).
- "Tech-product" abstract gradients with mesh/bokeh effects.
