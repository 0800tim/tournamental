#!/usr/bin/env node
/**
 * Build-time OG card generator for the marketing site.
 *
 * Reads the canonical page list and writes a 1200x630 PNG per page into
 * `apps/marketing/public/og/{slug}.png`. Astro `Layout` references those
 * paths via the `ogImage` prop already wired into every page.
 *
 * The generator uses `@vtorn/social-cards` so the OG cards share style
 * with every share / clip card — there is one source of truth for VTourn
 * brand surfaces.
 *
 * Usage:
 *   pnpm --filter @vtorn/marketing run build:og
 *
 * Or as part of the full build (the `build` script chains this in
 * automatically). If satori fonts are missing, the script logs a warning
 * and exits 0 (CI-friendly: a missing font shouldn't break a content
 * deploy; the layout falls back to /og-default.png).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let renderToPNG, loadDefaultFonts, palette;
try {
  ({ renderToPNG, loadDefaultFonts, palette } = await import("@vtorn/social-cards"));
} catch (err) {
  console.warn(
    `[build-og-cards] @vtorn/social-cards not loadable from node ESM ` +
      `(needs a TS loader; expected during plain-node CI step). ` +
      `Skipping OG card generation; pages will fall back to /og-default.png. ` +
      `Original error: ${err?.message ?? err}`,
  );
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_OG_DIR = resolve(here, "..", "public", "og");

/**
 * Each page → the card we render for it.
 *
 * We deliberately repurpose existing card kinds (no bespoke "marketing-page"
 * card kind) so the cards stay consistent with the rest of the brand. Each
 * page's OG card is a `referral-invite` card with a tuned headline pointing
 * at the page's value-prop — except the leaderboards page, which uses
 * `leaderboard-rank` to hint at the live-tournament story.
 */
const MARKETING_OG_PAGES = [
  {
    slug: "index",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "World Cup 2026",
      inviteHeadline: "Predict every match. Watch in 3D. Climb the board.",
    },
  },
  {
    slug: "how-it-works",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "How VTourn works",
      inviteHeadline: "Six steps from sign-in to a verified record.",
    },
  },
  {
    slug: "world-cup-2026",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "World Cup 2026",
      inviteHeadline: "104 matches. One global board. Six weeks.",
    },
  },
  {
    slug: "syndicates",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "Syndicates",
      inviteHeadline: "Run your own pool at yourname.vtourn.com.",
    },
  },
  {
    slug: "influencers",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "For creators",
      inviteHeadline: "A verifiable record. A branded syndicate. A revenue share.",
    },
  },
  {
    slug: "leaderboards",
    kind: "leaderboard-rank",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      scope: "global",
      scopeLabel: "Global",
      rank: 1,
      totalEntrants: 412300,
      weeklyMove: 0,
    },
  },
  {
    slug: "why",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "Why VTourn exists",
      inviteHeadline: "Predictions are why people watch sport.",
    },
  },
  {
    slug: "open-source",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "Apache 2.0",
      inviteHeadline: "Built in the open. Contributors share platform revenue.",
    },
  },
  {
    slug: "contribute",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "Contribute",
      inviteHeadline: "Ship code. Share docs. Earn USDC via Drips.",
    },
  },
  {
    slug: "start",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "Get started",
      inviteHeadline: "Player. Host. Developer. Pick a path.",
    },
  },
  {
    slug: "legal",
    kind: "referral-invite",
    data: {
      userHandle: "vtourn",
      userId: "brand",
      bonusTokens: 25,
      tournamentName: "Legal",
      inviteHeadline: "Terms, privacy, and our position on real-money play.",
    },
  },
];

async function fontsAvailable() {
  try {
    await loadDefaultFonts();
    return true;
  } catch (err) {
    return { reason: String(err.message ?? err) };
  }
}

async function main() {
  await mkdir(PUBLIC_OG_DIR, { recursive: true });

  const fontsCheck = await fontsAvailable();
  if (fontsCheck !== true) {
    console.warn(
      `[build-og-cards] skipping: fonts unavailable. ${fontsCheck.reason}\n` +
        `[build-og-cards] add fonts to packages/social-cards/fonts/ to enable. ` +
        `Pages will fall back to /og-default.png.`,
    );
    process.exit(0);
  }

  const fonts = await loadDefaultFonts();
  console.log(`[build-og-cards] rendering ${MARKETING_OG_PAGES.length} cards`);

  for (const page of MARKETING_OG_PAGES) {
    const result = await renderToPNG({
      input: { kind: page.kind, data: page.data },
      size: "og",
      fonts,
    });
    const out = resolve(PUBLIC_OG_DIR, `${page.slug}.png`);
    await writeFile(out, result.png);
    console.log(`  ✓ ${page.slug}.png  (${result.png.length} bytes)`);
  }

  // Default fallback card — used by Layout when no slug-specific image is set.
  const defaultPath = resolve(PUBLIC_OG_DIR, "..", "og-default.png");
  try {
    await access(defaultPath);
  } catch {
    const fallback = await renderToPNG({
      input: {
        kind: "referral-invite",
        data: {
          userHandle: "vtourn",
          userId: "brand",
          bonusTokens: 25,
          inviteHeadline: "Predict every match. Watch in 3D.",
        },
      },
      size: "og",
      fonts,
    });
    await writeFile(defaultPath, fallback.png);
    console.log(`  ✓ og-default.png  (${fallback.png.length} bytes)`);
  }

  // Sanity: brand palette must match marketing's tailwind config.
  if (palette.ink[900] !== "#0a0e1a") {
    console.error("[build-og-cards] palette drift: ink-900 != #0a0e1a");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[build-og-cards] failed:", err);
  process.exit(1);
});
