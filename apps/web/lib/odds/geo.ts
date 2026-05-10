/**
 * Geo-gating helper for the affiliate CTA.
 *
 * Per `docs/30-gamification-and-affiliate-spine.md` the Polymarket
 * affiliate CTA must be hidden in NZ + AU and most of the UK; the chip
 * itself stays visible (it's free editorial market intel). Pay-TV CTAs
 * are gated separately and require their own per-country provider
 * matching — this module only handles the Polymarket gating.
 *
 * On the server we read `cf-ipcountry` (Cloudflare's signed country
 * header). On the client, the page renders `<OddsHoverCard>` with a
 * `country` prop derived from a server-side detection passed down via
 * either a meta tag or initial-render data; the hover card defaults to
 * a safe "hide CTA" if the prop is missing.
 */

/**
 * ISO 3166-1 alpha-2 country codes where the Polymarket affiliate CTA
 * must NOT be shown. Source: docs/30 § "Geo-gating".
 *
 *  - NZ — Department of Internal Affairs treats overseas-prediction
 *    markets as gambling.
 *  - AU — ACMA treats them similarly.
 *  - UK — gated to "view market only" with no signup CTA. We hide the
 *    "Back this on Polymarket" copy entirely and offer a passive link.
 *
 * Anything not in this list is permitted.
 */
export const POLYMARKET_BLOCKED_COUNTRIES: ReadonlySet<string> = new Set([
  "NZ", "AU",
]);

/**
 * Countries where we show a softer "view market" link instead of a
 * "back this trade" CTA. The chip + numbers stay; the affiliate copy is
 * editorial.
 */
export const POLYMARKET_SOFTENED_COUNTRIES: ReadonlySet<string> = new Set([
  "GB", "UK",
]);

export type AffiliateCtaMode = "full" | "softened" | "hidden";

export function affiliateCtaMode(country: string | null | undefined): AffiliateCtaMode {
  if (!country) return "hidden";
  const cc = country.trim().toUpperCase();
  if (POLYMARKET_BLOCKED_COUNTRIES.has(cc)) return "hidden";
  if (POLYMARKET_SOFTENED_COUNTRIES.has(cc)) return "softened";
  return "full";
}

/**
 * Read the country from a Next.js Request (App Router). Returns `null`
 * if no Cloudflare header is present — caller decides the fallback.
 */
export function readCountryFromHeaders(
  headers: { get(name: string): string | null },
): string | null {
  return (
    headers.get("cf-ipcountry") ??
    headers.get("x-vercel-ip-country") ??
    headers.get("x-vtorn-country") ??
    null
  );
}

/**
 * Build the affiliate redirect URL with our ref code attached. We don't
 * import provider URLs here — the API route owns them — but the client
 * component uses this to construct a click-tracking link.
 */
export function buildPolymarketDeepLink(opts: {
  readonly marketId?: string;
  readonly outcomeToken?: string;
  readonly campaignId?: string;
  readonly source?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.marketId) params.set("market", opts.marketId);
  if (opts.outcomeToken) params.set("outcome", opts.outcomeToken);
  if (opts.campaignId) params.set("c", opts.campaignId);
  if (opts.source) params.set("s", opts.source);
  // Ref param: Tournamental Holdings affiliate code goes here once registered
  // (see docs/30 open question #1). Until then, point at our own click-
  // tracking endpoint that 302s to Polymarket.
  return `/api/affiliate/polymarket/click?${params.toString()}`;
}
