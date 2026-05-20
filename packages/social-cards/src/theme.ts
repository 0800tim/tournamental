/**
 * Brand theme used by every social card.
 *
 * Exact hex values mirror `docs/BRAND.md` Section 2 (gold + charcoal
 * editorial system, 2026-05-21). When the brand doc moves, update this
 * file and re-export the marketing build to regenerate static OG cards
 * under `apps/marketing/public/og/`.
 *
 * Legacy ink / accent / flame / emerald ramps remain exported so the
 * older sky-blue + flame cards keep typechecking until they are
 * repainted. New consumers should reach for the gold + charcoal tokens
 * (see `charcoal`, `gold`, and the `editorial.*` helpers).
 */

/** Charcoal canvas + neutral fg / borders. */
export const charcoal = {
  /** True charcoal canvas, no blue cast. */
  bg: "#15151a",
  /** Card / header chrome elevation. */
  bgElev: "#1c1c22",
  /** Hovered surfaces, secondary fills. */
  bgElev2: "#26262c",
  /** Hairline borders. */
  border: "#26262c",
  /** Stronger borders + focus rings. */
  borderStrong: "#3a3a44",
  /** Body text. */
  fg: "#e6e6ea",
  /** Secondary text, datelines on muted contexts. */
  fgMuted: "#a3a3ad",
  /** White-strong text for headings. */
  fgStrong: "#ffffff",
} as const;

/** Gold accent — the only new-work accent. */
export const gold = {
  50: "#fcf2d4",
  100: "#fcebb2",
  200: "#f0d27a",
  300: "#e6bf5e",
  /** Primary gold. */
  400: "#dca94b",
  500: "#c08a26",
  600: "#9a6a17",
  700: "#6b4708",
} as const;

/**
 * Legacy sky-blue + navy palette.
 *
 * @deprecated Use `charcoal` for surfaces and `gold` for accents. Kept
 * for cards that still import the old ramp (bracket-prediction et al.)
 * until they are repainted.
 */
export const ink = {
  900: "#0a0e1a",
  800: "#101626",
  700: "#1a2238",
  600: "#293352",
  500: "#3e4a72",
  200: "#cdd5e7",
  100: "#e7ecf7",
  50: "#f5f7fc",
} as const;

/**
 * Legacy sky-blue accent.
 *
 * @deprecated Use `gold[400]` for new work.
 */
export const accent = {
  400: "#7eb6e8",
  500: "#5a96d8",
  600: "#3f7cc4",
  700: "#2a5fa1",
} as const;

/**
 * Legacy flame accent.
 *
 * @deprecated Use `gold[400]` for new work; reserve flame only for
 * already-shipped components that depend on it.
 */
export const flame = {
  400: "#ffb37a",
  500: "#ff8a3d",
  600: "#e76b15",
} as const;

/**
 * Emerald — reserve for pitch-only renderer use. Do not introduce as a
 * new card accent; the editorial system is gold + charcoal.
 */
export const emerald = {
  500: "#21a34a",
  600: "#1a8038",
} as const;

export const palette = {
  charcoal,
  gold,
  // Legacy ramps. Reach for `charcoal` and `gold` instead.
  ink,
  accent,
  flame,
  emerald,
} as const;

/**
 * Sizes for the two card families produced for every kind.
 *
 * - `og` (1200×630) covers OG / X / Facebook / LinkedIn / Telegram link previews.
 * - `story` (1080×1920) covers TikTok, Instagram Reels, Instagram Stories, YouTube Shorts.
 *
 * The 1:1 (1080×1080) Instagram-feed format is intentionally not produced
 * by this layer: that variant is a *video* in our pipeline (per docs/14)
 * and the static thumbnail comes from the highest-action frame, not a card.
 */
export const sizes = {
  og: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
} as const;

export type CardSize = keyof typeof sizes;

/** Tournamental brand wordmark used in every card footer. */
export const wordmark = "Tournamental";

/**
 * Build the referral URL footer text.
 *
 * The referral URL is *part of every card* per the spec: every card has
 * the user's handle + a footer URL pointing to `tournamental.com/r/{user_id}`.
 */
export function referralUrl(args: {
  userId: string;
  utmSource: string;
  utmCampaign?: string;
}): string {
  const { userId, utmSource, utmCampaign } = args;
  const base = `https://tournamental.com/r/${encodeURIComponent(userId)}`;
  const params = new URLSearchParams({ utm_source: utmSource });
  if (utmCampaign) params.set("utm_campaign", utmCampaign);
  return `${base}?${params.toString()}`;
}

/**
 * Friendly version of the same URL that fits in a card footer (no scheme,
 * no params shown — the QR / link beneath carries the tracking).
 */
export function referralLabel(userId: string): string {
  return `tournamental.com/r/${userId}`;
}

/**
 * Pool / syndicate share URL footer label.
 *
 * Renders as `play.tournamental.com/s/<slug>` — the scheme is dropped so
 * the URL reads as a quiet metadata stamp in mono, mirroring the syndicate
 * OG route at `apps/web/app/api/og/syndicate/route.ts`.
 */
export function poolUrlLabel(slug: string): string {
  return `play.tournamental.com/s/${slug}`;
}
