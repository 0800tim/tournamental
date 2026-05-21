/**
 * EEA + UK + Switzerland country-code set.
 *
 * Used to region-gate the cookie consent banner: GDPR (EU 27 + EEA),
 * UK GDPR, and Swiss FADP all require explicit prompts; anywhere else
 * we keep analytics on the existing essential-only defaults and skip
 * the banner so first-paint is clean for the much bigger US / NZ / AU
 * audience.
 *
 * Codes are ISO 3166-1 alpha-2, matching what Cloudflare delivers in
 * the `CF-IPCountry` header. The list is intentionally static — the
 * EEA membership is treaty-stable so embedding it costs nothing and
 * removes a runtime lookup.
 */
export const EEA_PLUS_GDPR_COUNTRIES = new Set<string>([
  // EU 27
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA add-ons (EU but not in EU 27)
  "IS", "LI", "NO",
  // UK — post-Brexit but UK GDPR is functionally identical
  "GB",
  // Switzerland — FADP requires equivalent consent
  "CH",
  // EU outermost regions sometimes ship with their own ISO code
  "GP", "MQ", "GF", "RE", "YT",
]);

/** Returns true when `code` is a country we need a consent prompt for. */
export function isGdprCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  return EEA_PLUS_GDPR_COUNTRIES.has(code.toUpperCase().trim());
}

/**
 * "Unknown country" fallback policy. When Cloudflare doesn't supply
 * the header (local dev, direct origin probe, header stripped by a
 * proxy), we default to TREATING THE USER AS GDPR-GATED so we never
 * accidentally skip the banner for an actual EU visitor whose header
 * went missing in transit. Safer to over-prompt than to under-prompt.
 */
export function isGdprCountryOrUnknown(code: string | null | undefined): boolean {
  if (!code) return true;
  return EEA_PLUS_GDPR_COUNTRIES.has(code.toUpperCase().trim());
}
