---
date: 2026-05-11
agent: design-polish
status: shipped
branch: feat/marketing-design-polish
docs:
  - docs/15-vtourn-brand-and-positioning.md
  - docs/36-vtourn-ux-spec.md
  - apps/marketing/src/styles/globals.css
  - apps/marketing/src/components/Hero.astro
---

## Task

Take `apps/marketing` from "functional and themed" to "actually-good-looking,
motion-rich, brand-consistent". Five concrete polish passes plus minor fixes.

## Plan

1. **Hero motion** — animated rotating accent gradient ring around the
   match-card via CSS `@property` + keyframes; mouse parallax + device-tilt;
   typewriter reveal on H1; all gated behind `prefers-reduced-motion: reduce`.
2. **Section transitions** — single small inline script per page using
   `IntersectionObserver` to add `.is-in-view` to every `<section>`; staggered
   children via CSS variable `--vt-stagger`. 200ms ease-out fade-up.
3. **Typography** — self-host Inter variable font (regular + italic) under
   `/public/fonts/`; preconnect not needed since self-hosted; `font-display:
   swap`; wire into Tailwind `fontFamily.sans` + `fontFamily.display` and add
   `font-feature-settings`.
4. **Brand shapes** — four SVG icons in `/public/icons/vtorn/`: V mark, trophy,
   flag-pole, ball-with-trail. Replace generic favicon with the V mark. Use
   them in `SectionHeading.astro` (eyebrow icon slot) and the footer brand row.
5. **Footer redesign** — 3-column layout (brand+socials, navigation, legal) +
   live-count placeholder reading from `/api/version` with a sensible
   fallback.

Plus minor:
- iPhone-SE width (375): tighten H1 line-length and clamp size.
- COMING JUNE 2026 pill: pulse anim with 4% alpha shift.
- Play World Cup 2026 desktop button: sky-blue glow + hover intensify.

## Decisions

- **Inter** chosen over Geist because it has a bigger glyph set, NZ-friendly
  diacritics, and the wider character-set we need for international syndicate
  names. Variable font (one .woff2 file).
- **No JS framework**, no astro:client directives — all anim is CSS or
  vanilla `<script is:inline>`.
- **Reduced-motion** — every animation keyframe wrapped in
  `@media (prefers-reduced-motion: no-preference)`; the gradient ring still
  paints, just doesn't spin.
- **Live count** — placeholder string until `/api/version` returns; uses
  `fetch().catch()` so any failure falls back silently.

## Open questions

None blocking. The Playwright readability spec from PR #84 is gated on
`RUN_MARKETING_E2E=1`; will run locally to confirm contrast still passes.

## Outcome

- pnpm build: passes (12 pages, 5.3 s).
- pnpm typecheck: 0 errors / 0 warnings (3 pre-existing hints unrelated).
- Light-mode readability Playwright spec: 22/22 passing.
- Hero now has rotating accent halo + per-word cascade reveal + mouse
  parallax tilt + soft sky-blue glow on the primary CTA.
- Section reveal active on every `<section>` via IO observer in
  `Layout.astro`.
- Inter Variable self-hosted from `/public/fonts/`; preload + swap;
  Tailwind `fontFamily.sans` and `fontFamily.display` updated.
- Brand SVG icon set under `/public/icons/vtorn/`; replaces the old
  text "V" in the Header brand mark, the Footer brand mark, and
  the favicon.
- Footer redesigned: 3 columns, brand-icon section heads, 12,000+
  live-count placeholder pill, GitHub/Telegram/X social buttons,
  partners@vtourn.com contact link.
- iPhone-SE H1 + sub-headline tightened in `globals.css` so the hero
  reads cleanly at 375 px.
- "COMING JUNE 2026" pill on `/world-cup-2026` now pulses 1.5 s
  ease-in-out with a 4 % alpha shift; trophy icon prefixes the label.
- Desktop "Play World Cup 2026" header CTA + hero CTA both pick up
  the new `.vt-glow-cta` sky-blue halo.

Screenshots in `apps/marketing/e2e-screenshots/`:
- `index-desktop-{dark,light}.png`
- `index-iphone-se-{dark,light}.png`
- `world-cup-2026-desktop-{dark,light}.png`
- `hero-zoom-dark.png`, `hero-zoom-dark-2.png` (rotation midpoints)
- `footer-zoom-{dark,light}.png`
- `wc2026-hero-dark.png` (pulsing pill)
- baseline (pre-polish): `e2e-screenshots/before/`
