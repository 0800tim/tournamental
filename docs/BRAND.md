# BRAND.md, Tournamental visual + voice reference

> Single source of truth for the gold + charcoal + Fraunces editorial system
> that ships across `apps/marketing/` (tournamental.com) and `apps/web/`
> (play.tournamental.com). Read this before opening a PR that touches a
> public surface. If something here disagrees with the code, the code is
> wrong, not this doc, fix it in the same PR and link back here.

Last consolidated: 2026-05-21, after the half-applied editorial pass landed
on `main`. Updates that change visible surface area should bump the
"Last updated" line and note what changed.

## 1. Identity

### Brand mark

The gold soccer-ball mark is the only logotype Tournamental ships in 2026.
A single raster, scaled by the renderer:

- `apps/web/public/icons/icon-192.png`, primary PWA icon, served at 28px
  CSS on the AppBar (~7x density on retina) and 40px on the install toast.
- `apps/marketing/public/icon-mark.png`, same artwork on the marketing
  surface, served from the Astro header.

If the mark needs a vector, regenerate from the gold scale in section 2,
do not redraw by hand. The full PWA icon set (16, 32, 192, 256, 384, 512,
maskable, apple-touch) lives under `apps/web/public/icons/`.

### Wordmark

"Tournamental" set in **Fraunces 500** with the optical-size axis dialled
to 144 and the SOFT axis at 25. The class is `.vt-wordmark` (defined in
both `apps/web/app/globals.css` and `apps/marketing/src/styles/globals.css`).

The wordmark always reads on a charcoal or paper canvas, never inside a
coloured chip. Letter-spacing is mildly negative (`-0.012em`) so the
terminals feel like a sports broadsheet masthead rather than a textbook.

### Optional caption: `FWC2026`

Footnote-mono, 0.625rem, letter-spacing 0.12em, uppercase. Class is
`.vt-wordmark-meta`. Used as a subtitle next to the wordmark on the
AppBar and in the browser tab title to signal the current tournament
focus. Drop it on tournament-agnostic surfaces.

Avoid setting the caption in gold over a busy background; it should read
as a quiet metadata stamp, not a second logo.

## 2. Palette

### Surfaces (charcoal canvas, dark-only on `apps/web/`, dark + paper on `apps/marketing/`)

| Token              | Hex       | Use                                            |
|--------------------|-----------|------------------------------------------------|
| `--vt-bg`          | `#15151a` | Page canvas. True charcoal, no blue cast.      |
| `--vt-bg-elev`     | `#1c1c22` | Cards, header chrome.                           |
| `--vt-bg-elev-2`   | `#26262c` | Hovered surfaces, secondary fills.              |
| `--vt-border`      | `#26262c` | Hairlines on cards and dividers.                |
| `--vt-border-strong` | `#3a3a44` | High-contrast borders, focus rings.            |
| `--vt-fg`          | `#e6e6ea` | Body text.                                      |
| `--vt-fg-muted`    | `#a3a3ad` | Secondary text, datelines, captions.            |
| `--vt-fg-strong`   | `#ffffff` | Headings on dark canvas.                        |

The play app (`apps/web/`) is dark-only as of the gold + charcoal repaint.
The marketing site (`apps/marketing/`) keeps a paper light theme on
`:root[data-theme="light"]` for accessibility and reading comfort, the
toggle lives in the marketing header. Do not introduce a third surface
mode.

### Gold scale (the only accent for new work)

Read these from `apps/web/app/globals.css` and the Tailwind config; they
are mirrored in `apps/marketing/src/styles/globals.css` so non-utility
CSS can reach the same hex without a Tailwind round-trip.

| Token            | Hex       | Use                                                  |
|------------------|-----------|------------------------------------------------------|
| `--vt-gold-50`   | `#fcf2d4` | Faint tint, watermark backgrounds.                   |
| `--vt-gold-100`  | `#fcebb2` | Hover wash, secondary highlight.                     |
| `--vt-gold-200`  | `#f0d27a` | Disabled gold fills.                                 |
| `--vt-gold-300`  | `#e6bf5e` | Hover state on primary gold.                         |
| `--vt-gold-400`  | `#dca94b` | **Primary gold**, datelines, em-marks, rule strong.  |
| `--vt-gold-500`  | `#c08a26` | Pressed state, secondary gold.                        |
| `--vt-gold-600`  | `#9a6a17` | Body-text accent on light canvas.                     |
| `--vt-gold-700`  | `#6b4708` | Strong gold for borders on light canvas.              |

Rule of thumb: when in doubt, pick `--vt-gold-400`. Reserve `--vt-gold-50`
through `--vt-gold-200` for fills, `--vt-gold-500` through `--vt-gold-700`
for high-contrast strokes on a light canvas.

### Legacy accents (deprecated for new work)

These tokens are still defined for components that reference them
explicitly and have not yet been repainted. Do not introduce new uses.
Migrate to the gold scale when you touch the component.

| Token                | Hex       | What it was            | Status                       |
|----------------------|-----------|------------------------|------------------------------|
| `--vt-accent`        | `#6cabdd` | sky-blue brand accent  | deprecated; migrate to gold-400 |
| `--vt-accent-warm`   | `#f3b83b` | flame-orange accent    | deprecated; reads as a near-gold, swap to gold-400 |
| `--vt-accent-pitch`  | `#4cd680` | emerald-pitch accent   | deprecated; reserve emerald for pitch-only renderer use |

The sky-blue + gold mashup that crept into the bracket page is the
single biggest "AI slop" signal in the current codebase, see section 6.

## 3. Typography

### Display: Fraunces variable

- **File**: `/fonts/Fraunces-Variable.woff2` (~165 KB Latin Extended subset).
- **Hosted under**: `apps/web/public/fonts/` and `apps/marketing/public/fonts/`.
- **Axes**: `opsz` 9-144, `wght` 100-900, plus `SOFT` and `WONK`.
- **CSS hook**: `var(--vt-font-editorial)` or `theme(fontFamily.editorial)`.
- **Class**: scope a section with `.vt-editorial` to get the full type
  stack. Inside that scope, use `.vt-headline`, `.vt-section-head`,
  `.vt-lede`, `.vt-stat-num`, `.vt-stat-label`, `.vt-dateline`,
  `.vt-footnote`.

The Fraunces file only downloads when a class actually requests
`font-family: Fraunces`, so the cost is paid by editorial pages, not
by every shelled view. Always pair `font-family: Fraunces` with an
explicit `font-variation-settings` declaration so the optical-size axis
matches the type size.

### Body: Inter variable

- **Files**: `/fonts/Inter-Variable.woff2`, `/fonts/Inter-Variable-Italic.woff2`.
- **CSS hook**: `theme(fontFamily.sans)` on marketing; the play app
  uses the system stack with `Inter Variable` as the first fallback so
  the body paints instantly.
- **Feature settings**: `cv11` (single-storey `a`), `ss01` (open
  aperture digits) on marketing.

### Mono fallback

Stat captions, datelines, footnotes, and the `FWC2026` subtitle all use
`ui-monospace, Menlo, Monaco, monospace`. There is no self-hosted mono
file, the OS stack is intentional and bundle-friendly.

### Type sizes (the editorial scope)

Pulled from `apps/marketing/src/styles/globals.css` under the
`.vt-editorial` cascade. Use the class hooks rather than redefining the
clamp ranges.

| Class              | Sizes (mobile -> desktop)      | Notes                                |
|--------------------|--------------------------------|--------------------------------------|
| `.vt-headline`     | `clamp(2.75rem, 7vw, 6.25rem)` | Hero H1. `opsz 144`, line-height 0.98. |
| `.vt-section-head` | `clamp(1.875rem, 4vw, 3rem)`   | Section H2. `opsz 96`.                 |
| `.vt-lede`         | `clamp(1.1875rem, 1.6vw, 1.5rem)` | Italic Fraunces, `opsz 36`. Max 60ch.  |
| `.vt-stat-num`     | `clamp(2rem, 4.5vw, 4rem)`     | Gold, tabular numerals, `opsz 96`.      |
| `.vt-stat-label`   | `0.6875rem`                    | Mono, 0.12em tracking, uppercase, muted. |
| `.vt-dateline`     | `0.7rem`                       | Mono, 0.14em tracking, uppercase, gold.  |
| `.vt-footnote`     | `0.7rem`                       | Mono, 0.06em tracking, muted.            |
| `.vt-body`         | inherited (~1rem)              | Inter, line-height 1.55 by default.      |

Bracket-page and Match-renderer surfaces use their own type scales in
`bracket.css` and `globals.css` for HUD legibility (tabular-nums,
condensed sans). Editorial scope does not apply inside the renderer.

## 4. Motion grammar

### First-paint reveal stagger

A choreographed reveal animation runs on the homepage hero (and any
section opted into `.vt-editorial [data-reveal]`). Each element has an
explicit role so the cascade reads as a sequence rather than a wash.

- **Keyframes**: `vt-rise` (8px translate + opacity) and `vt-fade`
  (opacity only). Both defined in
  `apps/marketing/src/styles/globals.css`.
- **Hook**: `data-reveal="<role>"` on the target element. Roles in use:
  `dateline`, `headline`, `rule`, `lede`, `stats`, `cta`, `footnote`.
- **Step rhythm**: 60-120ms between roles. Concretely:
  dateline 0ms, headline 80ms, rule 240ms, lede 320ms, stats 460ms,
  cta 600ms, footnote 740ms.
- **Easing**: `cubic-bezier(0.16, 0.84, 0.32, 1)` for `vt-rise`,
  `ease-out` for `vt-fade`. Duration 700ms / 600ms.
- **Reduced motion**: a `prefers-reduced-motion: reduce` block collapses
  every reveal to `opacity: 1; transform: none; animation: none`. The
  end-state is the default, not the hidden state.

### Scroll-linked enhancement

Sections below the hero default to **visible**. An IntersectionObserver
adds `.is-in-view` for a tasteful fade once observed. The progressive-
enhancement contract:

- Default = visible. No-JS users, full-page screenshots, and slow
  connections all see the page.
- Sections that have not yet been observed but carry
  `data-vt-reveal-pending="1"` (stamped by the observer at runtime) get
  the hidden-then-fade treatment.
- `prefers-reduced-motion: reduce` skips the transition.

This pattern fixed the May 2026 launch regression where `opacity: 0`
sat baked into the stylesheet and the page below the hero rendered as
an empty canvas for anyone without the observer armed.

### GSAP for complex scroll-linked motion (Phase 3)

When the system needs scroll-pinned timelines, scrubbing, or chained
multi-element choreography, reach for GSAP + ScrollTrigger via the
`gsap-react` / `gsap-scrolltrigger` skills. Until then, CSS reveals
plus the observer are sufficient and bundle-cheap.

### Hover + ambient motion

- `.vt-hero-card` paints a conic-gradient ring via `::before` and
  rotates `--vt-angle` over 14s linear infinite. The custom property
  is registered through `@property` so the gradient transitions
  smoothly. Paused under reduced motion.
- `.vt-glow-cta` adds a sky-blue (legacy accent, soon gold) box-shadow
  bloom on hover; transform `translateY(-1px)`. Disabled under reduced
  motion.
- Standard 120-240ms eased transitions on buttons, pills, and
  interactive surfaces. Never animate filter or backdrop-filter on
  hover, the GPU cost surprises low-end Androids.

## 5. Copy voice

### NZ English

The codebase is NZ English. `colour`, `behaviour`, `organise`,
`favourite`, `centre`, `metre`. Comments, docs, UI copy. The reviewer
agent will catch US spellings on PR.

### No emdashes

Use a comma, a hyphen (with surrounding spaces is fine), or restructure
the sentence. No emdash, no endash. This is a hard rule across copy and
code comments because emdashes are an unmistakable LLM tell.

### Editorial sport voice

- Short declarative sentences. Subject, verb, fact. Pile two together,
  not three.
- Datelines and section heads carry the structure. Body copy stays
  plain.
- "Tournament Book" framing on the marketing surface, drawn from print
  sports almanacs. Read `apps/marketing/src/components/TournamentBook.astro`
  for a worked example.
- Numbers as numerals. `964 matches`, `48 teams`, `104 matches`,
  `Three things to know`. Spelling-out numbers in body copy reads
  precious.
- Avoid superlatives ("revolutionary", "best-in-class") and synonyms
  for "powerful". The product is interesting because of the spec and
  the receipts, not because of the adjectives.

### Established tone snapshots

For drift checks read these files:

- `apps/marketing/src/components/Hero.astro` (the H1 phrasing).
- `apps/marketing/src/components/TournamentBook.astro` (three-story
  editorial proof strip).
- `apps/web/app/world-cup-2026/page.tsx` and `bracket.css` (bracket H1
  + footer copy).
- `Tournamental Pitch.md` (the elevator pitch).

If you cannot tell whether your new copy fits, paste the existing hero
H1 above your draft and read both aloud, the cadence should match.

## 6. The "AI slop" rubric

Signals to avoid. Each one was visible somewhere in the May 2026
editorial pass before the cleanup. If you catch yourself reaching for
any of these, stop and pick the editorial alternative from the
right-hand column.

| Slop signal                                              | Editorial alternative                                              |
|----------------------------------------------------------|--------------------------------------------------------------------|
| Generic linear gradient on a card or hero                | Flat charcoal canvas. Hairline rule. Optional conic ring on hero only. |
| Three-column card grids of equal-weight icon + heading + blurb | Three numbered stories with datelines and hairline rules between them. |
| Dual-accent palette (sky-blue + gold, flame + gold)      | One accent: gold. Sky-blue and flame are deprecated for new work.    |
| `opacity: 0` baked into stylesheet, JS reveals on observe | Default visible. JS stamps `data-vt-reveal-pending="1"` to opt in.   |
| Emdashes anywhere                                        | Comma, hyphen with spaces, or restructure.                           |
| US spellings (`color`, `behavior`, `organize`, `center`) | NZ spellings (`colour`, `behaviour`, `organise`, `centre`).          |
| "Revolutionary", "best-in-class", "powerful", "seamless" | Plain language. The receipts prove the claim, the adjective doesn't. |
| Synonyms for the brand (e.g. `the platform`)             | Use `Tournamental`. The brand is the noun.                           |
| Centred copy blocks of 80 ch+ width                      | Left-aligned, max-width 60ch on `.vt-lede`, max-width 75ch on body.  |
| Drop shadows on cards over a charcoal canvas             | Hairline border + 1px gold rule for emphasis.                        |
| Pill chips with coloured fill, bordered, and shadowed     | One of: fill, border, or shadow. Never the trio.                     |
| Sky-blue link hover on a charcoal canvas                 | Gold underline grows on hover, no colour shift.                      |
| Generic stock-photo hero image                            | Editorial type setting carries the hero. No photography in v0.1.    |
| Heavy use of italics for emphasis                         | Reserve italic Fraunces for the `em` token inside `.vt-headline`.    |
| Layered blur + saturate backdrop filters everywhere       | Backdrop blur reserved for the AppBar overlay and drawer backdrop.  |

The rubric is non-exhaustive; the rule of thumb is "if it looks like the
default Tailwind landing page, it is not the brand".

## 7. Legal: avoid "FIFA" in public copy

Public-facing copy must say **"Football World Cup 2026"** or **"World
Cup 2026"**, never "FIFA World Cup 2026". The acronym is a registered
trademark of FIFA and using it in marketing copy invites a takedown
letter for an unaffiliated product.

Internal identifiers are fine and should not be renamed mid-flight:

- `data/fifa-wc-2026/` (fixtures directory).
- `fifa_rank` (canonical team field).
- `loadFixtures2026()` and similar internal function names.
- Code comments referencing the historic match
  `fifa-wc-2022-final-arg-fra-2022-12-18`.

The boundary is: anything a user sees says "Football World Cup 2026" or
"World Cup 2026". Anything the engine sees can keep the convenient
identifier.

The marketing site historically referred to "FIFA World Cup" in a few
places; those were swept in `651637e feat(marketing): fix all 404s,
redesign homepage for syndicates + leaderboard` and `4c8441f copy: drop
FIFA/host-country branding`. New copy should not regress.

## 8. Where the tokens live

The tokens are duplicated in two stylesheets today; a future PR may
extract them into `packages/design-tokens/`, but that work is deferred
(see the overnight-sprint task list in `docs/32-overnight-sprint-runbook.md`).

- `apps/web/app/globals.css`, gold scale, `--vt-font-editorial`,
  `.vt-wordmark`, `.vt-wordmark-meta`.
- `apps/web/components/shell/shell.css`, surface tokens, AppBar,
  drawer, bottom-nav, pill tabs, microsite sub-nav.
- `apps/marketing/src/styles/globals.css`, both palette variants
  (dark + paper), `.vt-editorial` scope, reveal keyframes, hero
  ambient motion.
- `apps/marketing/tailwind.config.{js,mjs}`, `ink-*`, `accent-*`,
  `flame-*`, `gold-*` Tailwind tokens.

When you change a token, update both stylesheets in the same PR. The
reviewer agent rejects token edits that drift across surfaces.

## 9. Maintenance

This doc is the source. Update it when:

- A token hex changes (the gold scale especially).
- A new class is added to the editorial scope.
- The motion grammar grows (a new role, a new keyframe, a new
  scroll-linked behaviour).
- A legal copy rule changes (e.g. additional trademarked phrases to
  avoid).

Bump the "Last consolidated" line at the top and note the change in the
PR body. Doc updates ride in the same PR as the code change, never as
a follow-up.
