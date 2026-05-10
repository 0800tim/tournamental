---
date: 2026-05-11
agent: marketing-blog (builder)
branch: feat/marketing-blog
status: complete
---

# Marketing /blog section + 3 inaugural posts

Tim asked overnight for a public blog on `vtourn.com` so we can publish
daily build-log + feature-showcase content as we ramp toward the
11 June 2026 World Cup kickoff. The brief was a mix of "how the app
works" / "feature show-off" / "behind-the-scenes technical" with
royalty-free hero imagery, and three inaugural posts documenting the
rapid 2-day build of the platform so far.

## Plan I followed

1. Confirm `apps/marketing/` is Astro 4.16 with Tailwind. Read the
   existing Layout, Header, Footer, theme tokens, and SEO pattern.
2. Add `@astrojs/mdx`, `@astrojs/rss`, `@astrojs/sitemap` (pinned to
   3.2.1 — see issue note below).
3. Define a single `blog` content collection in
   `src/content/config.ts` with strict frontmatter (title, description,
   pubDate, tags, optional heroImage + alt + credit, draft).
4. Build `src/pages/blog/index.astro`, `src/pages/blog/[...slug].astro`,
   `src/pages/blog/rss.xml.ts`.
5. Build new components under `src/components/blog/`: BlogCard, Prose,
   TagChip, PostFooter. All scoped CSS reading the existing theme
   tokens; no global theme changes.
6. Wire `/blog` into the existing Header `links` array and the Footer
   "Build" column.
7. Source three royalty-free hero images from Unsplash (Unsplash
   Licence — free for commercial use, attribution honoured), optimise
   under ~400 KB each.
8. Write the three MDX posts with concrete numbers pulled from
   `sessions/daily/2026-05-10.md`.
9. Build, typecheck, smoke-test routes locally on the dev server, kill
   the dev server cleanly.

## What shipped

### Posts (all 2026-05-11)

| Slug | Title | Words |
|------|-------|-------|
| `2026-05-11-from-zero-to-launch` | From zero to a working tournament prediction game in 48 hours | ~1,000 |
| `2026-05-11-the-bracket-game-explained` | The bracket game: how 104 picks become 1 winner | ~800 |
| `2026-05-11-watch-along-renderer-tech` | Watch the World Cup as a 3D scene — how our renderer works | ~1,050 |

All posts: NZ English spellings, no emdashes, no emojis in body copy,
concrete numbers from the Saturday daily report (21 PRs merged, ~470
unit tests, 6 new apps, 13 backend services, 56 new tests on the HUD).

### Hero images

| File | Source | Photographer | Licence |
|------|--------|--------------|---------|
| `/blog/2026-05-11-stadium-hero.jpg` | Unsplash photo `1731931594172-2e96a6a9acbf` | Nathan Wong | Unsplash Licence (free for commercial use, attribution appreciated) |
| `/blog/2026-05-11-laptops-hero.jpg` | Unsplash photo `1557804506-669a67965ba0` | Austin Distel | Unsplash Licence |
| `/blog/2026-05-11-pitch-aerial-hero.jpg` | Unsplash photo `1546608235-3310a2494cdf` | Timothy Tan | Unsplash Licence |

All three are wide aerial / architectural shots with no FIFA, World
Cup, club logos, or identifiable players in frame. Sized to 1600x900,
re-encoded with ImageMagick at q70-78 strip, all under 400 KB.
Attribution is included as `heroImageCredit` frontmatter and rendered
in the `<figcaption>` under the post hero image.

### Routes added

- `GET /blog/` — index (hero card + grid)
- `GET /blog/[slug]/` — post detail with Prose-wrapped MDX, tag chips,
  share buttons, related-posts strip
- `GET /blog/rss.xml` — RSS 2.0 feed

### Components added (new, isolated)

- `src/components/blog/BlogCard.astro`
- `src/components/blog/Prose.astro` (global is:global typography rules)
- `src/components/blog/TagChip.astro`
- `src/components/blog/PostFooter.astro`

All four are net-new files in a new subdirectory, so the concurrent
`feat/marketing-design-polish` branch should rebase clean — I did not
touch any existing component, layout, or stylesheet other than two
small list-element additions:

- `src/components/Header.astro` — one new `links` array entry
- `src/components/Footer.astro` — one new `<li>` in the Build column

If the design-polish branch also touches those two arrays, the conflict
will be tiny and obvious to resolve.

### Astro integrations added

- `@astrojs/mdx@^3.1.9` — MDX collection content
- `@astrojs/rss@^4.0.18` — RSS feed builder
- `@astrojs/sitemap@3.2.1` — pinned, see issue below

## Issue notes

**Sitemap version pin.** The `@astrojs/sitemap` package's latest
3.7.x release pulls in an Astro 5 hook signature that throws on
`_routes.reduce` against Astro 4.16. Pinned to **3.2.1** which works
against the workspace's pinned Astro 4.16. When the rest of the
marketing app upgrades to Astro 5, the cap on this dep can come off.

**OG card script.** `scripts/build-og-cards.mjs` already prints a soft
warning and falls back to `/og-default.png` when run from a plain Node
context (it imports a TS file from `@vtorn/social-cards`). Same as
existing pages — no regression here.

## Quality gates

- `pnpm --filter ./apps/marketing build` — passes (16 pages built,
  sitemap-index.xml generated)
- `pnpm --filter ./apps/marketing typecheck` (`astro check`) —
  0 errors / 0 warnings (3 pre-existing hints in
  `Header.astro`/`login.astro`, not introduced by this change)
- Booted `pnpm --filter ./apps/marketing dev`; `/blog`,
  `/blog/2026-05-11-from-zero-to-launch`,
  `/blog/2026-05-11-the-bracket-game-explained`,
  `/blog/2026-05-11-watch-along-renderer-tech`,
  `/blog/rss.xml` all returned 200. RSS XML well-formed with all 3
  items. Dev server killed cleanly at end of session.

## Performance notes

Per the standing rule that performance + caching are reviewed on every
PR:

- Hero images are static under `public/blog/` so they get the existing
  immutable cache treatment from the marketing site's edge config.
- Index thumbnails set `loading="lazy"` and explicit width/height so
  there is no layout shift as the hero image streams in.
- The hero image on the post page sets `loading="eager"` +
  `fetchpriority="high"` so it is part of LCP.
- `Prose.astro` ships only the typography it needs (no
  `@tailwindcss/typography` dependency footprint).
- No new runtime JS apart from the small inline copy-link handler in
  `PostFooter.astro` (~30 lines) — no React, no hydration, no
  client-side framework added.

## What's parked in IDEAS.md

Did not need to add anything. The posts mention forward-looking work
(VStamp on Arbitrum, live SportRadar feed, Capacitor shell, Drips
revenue share) but every one of those is already tracked in the daily
report and `docs/`.

## Next steps for the orchestrator

- Merge `feat/marketing-design-polish` first (it predates this branch).
  Once it's in, rebase this branch onto main and merge.
- After merge, schedule a cron-style trigger to add a new MDX file
  every day pulling from the previous day's `sessions/daily/`.
- Configure CI to fail if a post's frontmatter is missing `pubDate`,
  `description` or (when `heroImage` is set) `heroImageCredit`.
