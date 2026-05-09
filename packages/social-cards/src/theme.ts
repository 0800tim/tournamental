/**
 * Brand theme used by every social card.
 *
 * Exact hex values mirror `apps/marketing/tailwind.config.mjs`. If marketing
 * updates the palette, update this file (and re-export the marketing build
 * to regenerate static OG cards under `apps/marketing/public/og/`).
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

export const accent = {
  400: "#7eb6e8",
  500: "#5a96d8",
  600: "#3f7cc4",
  700: "#2a5fa1",
} as const;

export const flame = {
  400: "#ffb37a",
  500: "#ff8a3d",
  600: "#e76b15",
} as const;

export const emerald = {
  500: "#21a34a",
  600: "#1a8038",
} as const;

export const palette = { ink, accent, flame, emerald } as const;

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

/** VTourn brand wordmark used in every card footer. */
export const wordmark = "VTourn";

/**
 * Build the referral URL footer text.
 *
 * The referral URL is *part of every card* per the spec: every card has
 * the user's handle + a footer URL pointing to `vtourn.com/r/{user_id}`.
 */
export function referralUrl(args: {
  userId: string;
  utmSource: string;
  utmCampaign?: string;
}): string {
  const { userId, utmSource, utmCampaign } = args;
  const base = `https://vtourn.com/r/${encodeURIComponent(userId)}`;
  const params = new URLSearchParams({ utm_source: utmSource });
  if (utmCampaign) params.set("utm_campaign", utmCampaign);
  return `${base}?${params.toString()}`;
}

/**
 * Friendly version of the same URL that fits in a card footer (no scheme,
 * no params shown — the QR / link beneath carries the tracking).
 */
export function referralLabel(userId: string): string {
  return `vtourn.com/r/${userId}`;
}
