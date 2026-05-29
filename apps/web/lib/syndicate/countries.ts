/**
 * Shared list of countries the syndicate UI exposes for owner-phone
 * selection AND for the country-gate allow-list.
 *
 * Hoisted out of `apps/web/app/syndicates/new/SyndicateForm.tsx` so
 * the create form, the edit form, the directory badge, the join
 * notice, and the ineligible screen all render from the same source
 * of truth. Adding a country here surfaces it everywhere in one
 * change.
 *
 * `dial` is stored WITHOUT the leading "+" in the DB column
 * `syndicates.allowed_phone_countries` (so a CSV of dial codes stays
 * URL-safe + space-efficient); the leading "+" is only attached at
 * the UI layer.
 */

export interface CountryEntry {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  /** Dial code with the leading "+", as the phone input renders it. */
  dial: string;
  /** Human label. */
  name: string;
  /** Regional-indicator flag emoji, for badges + screens. */
  flag: string;
}

/**
 * Source of truth. Keep sorted roughly by likely usage in v1 (NZ
 * first since most pool admins are NZ-based, then AU/UK/US, then
 * Tournamental's outreach markets). Order also drives default
 * picker rendering.
 */
export const COUNTRIES: readonly CountryEntry[] = [
  { iso: "NZ", dial: "+64", name: "New Zealand", flag: "🇳🇿" },
  { iso: "AU", dial: "+61", name: "Australia", flag: "🇦🇺" },
  { iso: "GB", dial: "+44", name: "United Kingdom", flag: "🇬🇧" },
  { iso: "US", dial: "+1", name: "United States", flag: "🇺🇸" },
  { iso: "CA", dial: "+1", name: "Canada", flag: "🇨🇦" },
  { iso: "IE", dial: "+353", name: "Ireland", flag: "🇮🇪" },
  { iso: "ZA", dial: "+27", name: "South Africa", flag: "🇿🇦" },
  { iso: "IN", dial: "+91", name: "India", flag: "🇮🇳" },
  { iso: "BR", dial: "+55", name: "Brazil", flag: "🇧🇷" },
  { iso: "DE", dial: "+49", name: "Germany", flag: "🇩🇪" },
  { iso: "FR", dial: "+33", name: "France", flag: "🇫🇷" },
  { iso: "ES", dial: "+34", name: "Spain", flag: "🇪🇸" },
  { iso: "PT", dial: "+351", name: "Portugal", flag: "🇵🇹" },
  { iso: "IT", dial: "+39", name: "Italy", flag: "🇮🇹" },
  { iso: "NL", dial: "+31", name: "Netherlands", flag: "🇳🇱" },
  { iso: "AR", dial: "+54", name: "Argentina", flag: "🇦🇷" },
  { iso: "MX", dial: "+52", name: "Mexico", flag: "🇲🇽" },
] as const;

/** Bare dial code (no "+") used in the DB column. */
export function bareDialCode(dialWithPlus: string): string {
  return dialWithPlus.replace(/^\+/, "");
}

/** Look up a country by ISO-2. Case-insensitive. */
export function countryByIso(iso: string | null | undefined): CountryEntry | null {
  if (!iso) return null;
  const u = iso.toUpperCase();
  return COUNTRIES.find((c) => c.iso === u) ?? null;
}

/**
 * Look up a country by bare dial code (e.g. "64"). When the dial
 * code is ambiguous (e.g. "1" maps to both US and CA), returns the
 * first match in `COUNTRIES` order so the UI renders consistently.
 */
export function countryByDial(bareDial: string | null | undefined): CountryEntry | null {
  if (!bareDial) return null;
  const cleaned = bareDial.replace(/\D/g, "");
  if (!cleaned) return null;
  return COUNTRIES.find((c) => bareDialCode(c.dial) === cleaned) ?? null;
}

/**
 * All countries that share a dial code prefix (for the +1 = US/CA
 * disambiguation in admin help copy + badge tooltips).
 */
export function countriesByDial(bareDial: string): CountryEntry[] {
  const cleaned = bareDial.replace(/\D/g, "");
  return COUNTRIES.filter((c) => bareDialCode(c.dial) === cleaned);
}
