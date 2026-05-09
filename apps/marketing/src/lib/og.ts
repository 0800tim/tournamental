/**
 * Per-page OG image map.
 *
 * Marketing pages declare their slug; we resolve to the static PNG path
 * generated at build time by `apps/marketing/scripts/build-og-cards.mjs`
 * (writes to `apps/marketing/public/og/{slug}.png`).
 *
 * Pages that don't appear in the map fall back to the default `/og-default.png`,
 * which the Layout component already handles.
 *
 * Adding a new page:
 *   1. Add an entry below.
 *   2. Add an entry in `MARKETING_OG_PAGES` in `scripts/build-og-cards.mjs`
 *      with the title + subtitle that should appear on the card.
 *   3. Run `pnpm --filter @vtorn/marketing run build:og` (or full `build`).
 */

export const ogImageForSlug: Record<string, string> = {
  "": "/og/index.png",
  index: "/og/index.png",
  "how-it-works": "/og/how-it-works.png",
  "world-cup-2026": "/og/world-cup-2026.png",
  syndicates: "/og/syndicates.png",
  influencers: "/og/influencers.png",
  leaderboards: "/og/leaderboards.png",
  why: "/og/why.png",
  "open-source": "/og/open-source.png",
  contribute: "/og/contribute.png",
  start: "/og/start.png",
  legal: "/og/legal.png",
};

/** Resolve the OG image path for a page slug (with sensible fallback). */
export function ogImageFor(slug: string): string {
  return ogImageForSlug[slug] ?? "/og-default.png";
}
