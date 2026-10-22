---
title: Overnight editorial design refresh
date: 2026-05-21
status: shipped
branch: main (commits aa87ef7 through a29e367 + a few earlier)
prod: tournamental.com + play.tournamental.com (both live)
---

# Overnight editorial design refresh

> One-line: replaced the "AI-slop" cream-and-sky-blue SaaS look with a
> dark-charcoal + gold-soccer-ball + Fraunces editorial-sport identity
> across every public surface, plus made the play app an installable
> PWA. Five phases, six agents, ~12 commits on main.

## Why

The maintainer flagged the existing design as "AI slop" — generic
gradient overuse, cards-in-cards, dual sky-blue + gold accent
collisions, opacity:0 reveals that locked content out of no-JS clients,
duplicate hero card stacks on the share landing. The redesign brief
was to land a single, coherent editorial-sport direction (think *The
Athletic* / *FT Sport*) across both apps and prove the system was
applied consistently, not "half-half" like before.

## What landed

### Phase 0 — stop the bleeding (manual, 1 commit, `47fc766`)

Four bug-class issues blocking every downstream phase from looking
right:

1. Marketing's `section.vt-reveal` defaulted to `opacity: 0` until an
   IntersectionObserver stamped `.is-in-view`. Full-page screenshots,
   no-JS users, SEO crawlers, and slow-JS clients saw the page as
   hero-then-footer. Repointed the CSS to key on
   `data-vt-reveal-pending="1"` so default = visible, observer adds
   polish.
2. `/s/<slug>` share landing had a duplicate hero (the inline OG
   preview image rendering "Tournamental + member count + FREE TO
   PLAY" sky-blue chip under the editorial header). Removed.
3. `/s/<slug>` sub-heads (PRIZE POOL, LEADERBOARD TOP 5, RECENT
   MEMBERS) were sky-blue. Repointed `--vt-share-accent` to gold.
4. AppMenuDrawer (the slide-in nav menu) still showed the old
   sky-blue "T" chip + sky-blue link icons. Swapped to the gold-ball
   PNG, drawer link icons to gold.

### Phase 1 — foundation (1 agent, 2 commits)

- `docs/BRAND.md` — single-source brand reference. Identity, palette
  (charcoal `#15151a` canvas, gold scale `--vt-gold-50` through
  `--vt-gold-700`), typography (Fraunces variable + Inter), motion
  grammar, copy voice (NZ English, no emdashes), AI-slop rubric,
  trademark note (no public FIFA references).
- Force dark mode on play.tournamental.com. Removed the
  `[data-theme="light"]` override block from `shell.css` so the play
  app is a single dark-canvas surface. Marketing still has its
  light/dark toggle. Bracket page per-page `data-theme="light"`
  (used by the embed iframe) still works.

### Phase 2 — three parallel surface agents

**Phase 2A — marketing pages, "After Hours" editorial template** (6 commits)
- Recomposed `/syndicates`, `/how-it-works`, `/leaderboards`, and
  `/world-cup-2026` as editorial articles. Each opens with a dateline
  + Fraunces opsz-144 head with optional italic gold emphasis word +
  italic Fraunces lede + footnote.
- New reusable Astro components: `EditorialPageHeader`, `PrincipleList`,
  `EditorialTable`, `EditorialStatGrid`.
- Footer replaced with editorial colophon: "Tournamental, founded
  May 2026 in Wellington, Aotearoa. Apache 2.0 code. CC-BY docs."
  Three hairline-ruled columns. Build-time "Next edition" caption
  ticks toward kickoff like a print masthead.

**Phase 2B — bracket polish** (5 commits)
- Stage-as-page mobile IA. Tabs (Groups, R32, R16, QF, SF + 3rd,
  Final) now drive a horizontal scroll-snap carousel below 768px so
  users swipe between rounds instead of remount-and-scroll.
- Elevated gold selection: 4px outer ring + 12-16px halo on picked
  flags / knockout cells. Unselected siblings desaturate to 0.55
  saturation + 0.45 opacity once a winner is committed.
- GSAP cascade pulse (`apps/web/lib/bracket/use-cascade-pulse.ts`).
  When a group winner unlocks a downstream R32 / R16 / QF matchup,
  the affected card pulses gold for 600ms.
- Fraunces 500 small-caps group labels with gold leading dot.
- Density pass: tighter pick rows, quieter `⋯` more-details affordance
  moved to bottom-right, smaller `Add score` toggle.

**Phase 2C — share landing rebuild** (3 commits)
- Single 720px editorial column. Dateline + Fraunces opsz-144
  "The Crate"-style headline + italic Fraunces lede + tabular gold
  prize-pool stat grid + editorial leaderboard chart + gold-pill
  JOIN CTA + recent members tile grid + mono colophon footer.
- Custom OG image generator (`apps/web/app/api/og/syndicate/route.ts`)
  rewritten: gold ball top-left, gold mono dateline, Fraunces-500
  display head with auto-shrink for long names, hairline rule above
  tabular stat row, mono URL footer. No more navy radial, no sky-blue
  chip, no "FREE TO PLAY" bubble.
- Editorial sponsor caption: "SPONSORED BY · <NAME>" mono dateline,
  optional logo + italic Fraunces sponsor name, optional link wrap.
  Seeded "Tim & Friends" sample syndicate with a real sponsor for
  preview surfaces.

### Phase 3 — three parallel agents

**Phase 3D — GSAP motion vocabulary** (1 commit)
- New shared module `apps/web/lib/motion/`:
  - `index.ts` — single gsap import, lazy `armScrollTrigger()`,
    SSR-safe `reduceMotion()` helper.
  - `use-count-up.ts` — 0.9s `power2.out` tween from 0 to target on
    ScrollTrigger.
  - `use-reveal-on-scroll.ts` — 600ms `power3.out` fade-and-rise with
    70ms stagger across children.
  - `use-node-hover-glow.ts` — tweens three.js material opacity on
    R3F atom hover (the molecule scene).
- Applied to the play homepage steps, share landing prize block /
  leaderboard / recent members, bracket lock summary count-ups,
  molecule node hover micro-interactions.
- Bundle cost: +45-46 KB First Load per route (gsap-core +
  ScrollTrigger). Documented; can dynamic-import to recover if needed.

**Phase 3E — social-cards pipeline** (1 commit)
- New `packages/social-cards/src/editorial.ts` primitives: `goldBall`,
  `dateline`, `editorialHeadline`, `tabularStatRow`, `charcoalCanvas`,
  `footerUrl`, `editorialScale`.
- Four new presets, each landscape (1200x630) + story (1080x1920):
  - `prediction-pick` — "{user} backs {team} to beat {opponent}".
  - `leaderboard-rank-up` — "Moved to position {N}".
  - `perfect-week` — "7 calls, 7 right." (italic gold emphasis).
  - `syndicate-invite` — pool name + Members/Picks/Entry stats.
- Static Fraunces TTFs vendored into `packages/social-cards/fonts/`
  because satori doesn't support woff2 or variable axes.
- 8 new vitest cases render 8 sample PNGs and assert PNG magic
  bytes + IHDR dimensions + >8 KB. 118 tests total pass (110 legacy
  cards still working).
- Legacy navy/sky-blue cards marked `@deprecated` but still exported
  for back-compat. Migration playbook in `packages/social-cards/README.md`.

**Phase 3G — PWA installable** (2 commits)
- `manifest.webmanifest` renamed to "Tournamental, Football World Cup
  2026" (no FIFA per BRAND.md §7). theme_color + background_color
  flipped to charcoal `#15151a`. Predict shortcut copy de-FIFA'd.
  Icons unchanged (already gold-ball at 192/512 any + maskable).
- `sw.js` precache list extended with `/offline`, apple-touch-icon,
  Fraunces variable woff2. `/fonts` added to cache-first prefixes.
  Navigation fallback now `network → /offline → /`. Cache bumped to
  `vt-shell-v1-2026-05-21`.
- New `/offline` page: gold ball + Fraunces "Offline" headline + try-
  again caption on charcoal. No client JS. `robots: noindex`.
- `InstallPrompt.tsx` rewritten. No longer a floating toast. Mounts
  as the final inline line inside the menu drawer (below "More").
  Handles `beforeinstallprompt` (Chromium / Android), iOS Safari
  (regex UA test, "tap share, then Add to Home Screen" hint), and
  hides entirely when `display-mode: standalone` matches. Dismissal
  persists 30 days via `localStorage["vt-install-dismissed-at"]`.

### Phase 4 — reviewer

Dispatched but failed at the Anthropic API with a 529 Overloaded
after 123 tool uses. The reviewer was a critique-and-fix loop on
each shipped surface. Its absence is not blocking — every Phase 2/3
agent ran their own typecheck + tests before commit, and I personally
audited the bracket page and share landing at 390 + 1366 widths via
playwright after deploy.

The atomic-fix sweep the reviewer would have done is deferred to a
follow-up session. Candidates:
- Light-theme overrides on light-mode bracket embed iframe still
  contain a few legacy slate hexes.
- Light-mode marketing site doesn't yet wear the gold-on-paper
  variant the dark version has.
- 26 pre-existing test failures (form gating, auth, mock fixtures)
  remain; none caused by this refresh.

## Commits on main (this session)

```
47fc766 phase-0: complete the half-applied editorial pass
8d1d5f7 docs(brand): single-source reference for the gold + charcoal + Fraunces system
8bfdb70 shell: drop light-mode tokens on play app, gold-charcoal-only canvas
1bfaffd feat(marketing): editorial recompose of /syndicates as an argument
719f107 feat(marketing): editorial recompose of /how-it-works as magazine longform
04fb0b0 feat(marketing): editorial recompose of /leaderboards
b2d35cb feat(marketing): editorial recompose of /world-cup-2026
cc37b5d feat(marketing): editorial colophon footer
2c53a31 fix(marketing): drop emdash glyph from leaderboards scope grid
fb0a01a style(bracket): Fraunces small-caps group labels + density pass
ae92309 style(bracket): elevated gold pick state with 4px ring + 16px halo
e715a8b feat(bracket): stage-as-page mobile IA via scroll-snap carousel
7c493ed feat(bracket): GSAP cascade pulse on newly-unlocked downstream cards
60813b6 docs(sessions): agent B sign-off outcome
557caac design(share-landing): rebuild /s/<slug> as a 720px editorial column
f35410f design(og-syndicate): gold ball + Fraunces editorial PNG, no sky-blue
6c354c9 design(share-landing): editorial sponsor caption + seed sample data
b127d8e pwa(manifest+sw): align with brand, precache offline page + Fraunces
be5b4ad pwa(install): inline drawer affordance, iOS hint, 30-day dismissal
9358353 social-cards: editorial preset pipeline (gold + charcoal + Fraunces)
a29e367 motion: one GSAP vocabulary across the play app
```

## Live verification

All deployed; full curl sweep on session close:

**tournamental.com (marketing)**
| URL | Status |
|---|---|
| `/` | 200, new editorial hero + Tournament Book proof + colophon footer |
| `/syndicates` | 200, editorial argument structure |
| `/how-it-works` | 200, magazine longform |
| `/leaderboards` | 200, editorial intro + demo + scope stat grid |
| `/world-cup-2026` | 200, editorial dateline + scale stats + audience principles |
| `/favicon.ico` | 200, gold ball multi-size .ico |
| `/icon-mark.png` | 200, gold ball |
| `/fonts/Fraunces-Variable.woff2` | 200, 165 KB Latin-extended subset |

**play.tournamental.com (app)**
| URL | Status |
|---|---|
| `/` | 200, editorial hero with gold italic "every match" |
| `/world-cup-2026` | 200, bracket with stage-as-page mobile + gold selection |
| `/world-cup-2026/molecule` | 200, GSAP-hover-glow on atoms |
| `/s/the-crate` | 200, single-column editorial landing |
| `/manifest.webmanifest` | 200, Tournamental name + charcoal theme + 6 icons |
| `/sw.js` | 200, service worker registered + precache hot |
| `/offline` | 200, Fraunces "Offline" + gold ball + try-again caption |
| `/api/healthz` | 200, `{ ok: true, service: "vtorn-web" }` |
| `/icons/icon-192.png` | 200, gold ball |
| `/pools` | 307 → `/syndicates` (in-flight rename redirect) |
| `/embed/widget.js` | 200, partner-site widget bundle |

## Files inventory

- `docs/BRAND.md` — canonical brand reference (348 lines).
- `apps/marketing/src/components/EditorialPageHeader.astro` — new.
- `apps/marketing/src/components/PrincipleList.astro` — new.
- `apps/marketing/src/components/EditorialTable.astro` — new.
- `apps/marketing/src/components/EditorialStatGrid.astro` — new.
- `apps/marketing/src/components/Footer.astro` — rewritten.
- `apps/web/lib/motion/` — new shared motion module.
- `apps/web/components/motion/RevealOnScroll.tsx` — new client shim.
- `apps/web/components/share-landing/SyndicateLeaderboardRows.tsx` — new client wrapper for leaderboard count-ups.
- `apps/web/lib/bracket/use-cascade-pulse.ts` — new GSAP hook.
- `apps/web/app/offline/page.tsx` — new offline page.
- `apps/web/public/sw.js` — service worker rewritten.
- `apps/web/public/manifest.webmanifest` — aligned with brand.
- `packages/social-cards/src/editorial.ts` — new primitives.
- `packages/social-cards/src/presets/` — 4 new presets.
- `packages/social-cards/__tests__/presets.test.ts` — 8 new tests.
- `apps/web/components/shell/AppMenuDrawer.tsx` — gold ball mark + Fraunces wordmark.
- `apps/web/components/shell/AppBar.tsx` — gold ball + FWC2026 wordmark (from prior session).
- `apps/web/components/shell/InstallPrompt.tsx` — rewritten as drawer-inline affordance.
- 70+ inline hex swaps across `apps/web/app/world-cup-2026/bracket.css` (slate → charcoal).

## Open follow-ups

1. **Light-theme parity for marketing**. The dark side is brand-locked;
   the paper-canvas light variant doesn't yet feel like the same
   product. Either build the warm-paper + deep-ink + gold equivalent,
   or force dark on marketing too.
2. **OG endpoints not yet on new presets**. `apps/web/app/api/og/bracket/route.ts`
   and `apps/api/src/routes/social-cards.ts` still call the legacy
   navy/sky-blue builders. Migration is a single-PR job per route.
3. **Reviewer pass deferred** (Anthropic 529). The atomic-fix sweep
   never landed. A follow-up session should run the same critique
   loop and patch anything <7.
4. **Bracket-embed light theme overrides** in `bracket.css` still
   reference a few slate hexes. Low-traffic surface but should be
   harmonised with the charcoal token set.
5. **Pre-existing test failures (26)** still red. Mostly form-gate
   auth assertions written before the SyndicateForm refactor.
   Unrelated to this session.

## What it looks like now

A mobile user opening play.tournamental.com sees:
- Gold ball + "Tournamental FWC2026" wordmark at top-left.
- Editorial dateline + Fraunces opsz-144 headline with gold italic
  "every match" of the World Cup.
- Scrolling reveals each step section with a 600ms fade-up.
- Tapping a group winner triggers a gold pulse on the unlocked R32
  card downstream.
- Picked teams wear a 4px gold ring + 16px halo. Other sides desaturate.
- The 3D molecule node hover paints a back-side gold sphere glow.
- "Install Tournamental as an app →" sits in the slide-in menu drawer.
- The 1200x630 OG image for any syndicate share is the gold-ball +
  Fraunces composition.

A desktop user opening tournamental.com sees:
- Magazine-cover editorial hero. Dateline + Fraunces opsz-144 + lede
  + tabular stat row + single primary CTA.
- Tournament Book three-story proof strip beneath the hero.
- Editorial colophon footer reading like a print imprint.
- Every secondary page (`/syndicates`, `/how-it-works`, `/leaderboards`,
  `/world-cup-2026`) lifted to the same editorial calibre with shared
  primitives.

The site no longer reads as AI-generated SaaS.
