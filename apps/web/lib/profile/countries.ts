/**
 * Lightweight country list for the profile dropdown.
 *
 * Each entry: ISO-3166-1 alpha-2, display name, E.164 dial code.
 *
 * The list is curated rather than imported from a 100kB country
 * package because the profile page is on the auth hot-path: every
 * signed-in user loads it. The 50-ish entries cover ~99% of likely
 * Tournamental users (every FIFA-confederation member country with
 * a meaningful sports audience) and the "Other" sentinel covers the
 * long tail.
 *
 * The dial code is also used to auto-pick the user's country from
 * their E.164 sign-in phone via `detectCountryFromPhone(phone)`.
 */

export interface Country {
  /** ISO-3166-1 alpha-2 code. */
  readonly code: string;
  /** Human-readable name. */
  readonly name: string;
  /** E.164 international dial code, no leading +. */
  readonly dial: string;
}

/**
 * Curated list ordered alphabetically by name. Common FIFA-tournament
 * audiences are all here; the "Other" sentinel falls through for
 * everything else.
 */
export const COUNTRIES: readonly Country[] = [
  { code: "AR", name: "Argentina", dial: "54" },
  { code: "AU", name: "Australia", dial: "61" },
  { code: "AT", name: "Austria", dial: "43" },
  { code: "BE", name: "Belgium", dial: "32" },
  { code: "BR", name: "Brazil", dial: "55" },
  { code: "CA", name: "Canada", dial: "1" },
  { code: "CL", name: "Chile", dial: "56" },
  { code: "CN", name: "China", dial: "86" },
  { code: "CO", name: "Colombia", dial: "57" },
  { code: "HR", name: "Croatia", dial: "385" },
  { code: "CZ", name: "Czechia", dial: "420" },
  { code: "DK", name: "Denmark", dial: "45" },
  { code: "EC", name: "Ecuador", dial: "593" },
  { code: "EG", name: "Egypt", dial: "20" },
  { code: "FI", name: "Finland", dial: "358" },
  { code: "FR", name: "France", dial: "33" },
  { code: "DE", name: "Germany", dial: "49" },
  { code: "GH", name: "Ghana", dial: "233" },
  { code: "GR", name: "Greece", dial: "30" },
  { code: "HK", name: "Hong Kong", dial: "852" },
  { code: "IN", name: "India", dial: "91" },
  { code: "ID", name: "Indonesia", dial: "62" },
  { code: "IR", name: "Iran", dial: "98" },
  { code: "IE", name: "Ireland", dial: "353" },
  { code: "IL", name: "Israel", dial: "972" },
  { code: "IT", name: "Italy", dial: "39" },
  { code: "CI", name: "Ivory Coast", dial: "225" },
  { code: "JP", name: "Japan", dial: "81" },
  { code: "JO", name: "Jordan", dial: "962" },
  { code: "MY", name: "Malaysia", dial: "60" },
  { code: "MX", name: "Mexico", dial: "52" },
  { code: "MA", name: "Morocco", dial: "212" },
  { code: "NL", name: "Netherlands", dial: "31" },
  { code: "NZ", name: "New Zealand", dial: "64" },
  { code: "NG", name: "Nigeria", dial: "234" },
  { code: "NO", name: "Norway", dial: "47" },
  { code: "PH", name: "Philippines", dial: "63" },
  { code: "PL", name: "Poland", dial: "48" },
  { code: "PT", name: "Portugal", dial: "351" },
  { code: "QA", name: "Qatar", dial: "974" },
  { code: "RO", name: "Romania", dial: "40" },
  { code: "RU", name: "Russia", dial: "7" },
  { code: "SA", name: "Saudi Arabia", dial: "966" },
  { code: "RS", name: "Serbia", dial: "381" },
  { code: "SG", name: "Singapore", dial: "65" },
  { code: "ZA", name: "South Africa", dial: "27" },
  { code: "KR", name: "South Korea", dial: "82" },
  { code: "ES", name: "Spain", dial: "34" },
  { code: "SE", name: "Sweden", dial: "46" },
  { code: "CH", name: "Switzerland", dial: "41" },
  { code: "TH", name: "Thailand", dial: "66" },
  { code: "TN", name: "Tunisia", dial: "216" },
  { code: "TR", name: "Turkey", dial: "90" },
  { code: "UA", name: "Ukraine", dial: "380" },
  { code: "AE", name: "United Arab Emirates", dial: "971" },
  { code: "GB", name: "United Kingdom", dial: "44" },
  { code: "US", name: "United States", dial: "1" },
  { code: "UY", name: "Uruguay", dial: "598" },
  { code: "VE", name: "Venezuela", dial: "58" },
  { code: "VN", name: "Vietnam", dial: "84" },
];

/**
 * Find a country by ISO-2 code (case-insensitive). Returns null on
 * miss rather than throwing so callers can fall through to "Other".
 */
export function findCountryByCode(code: string | null | undefined): Country | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return COUNTRIES.find((x) => x.code === c) ?? null;
}

/**
 * Heuristic: given an E.164 phone (e.g. "+6421000123"), pick the most
 * likely country. Falls back to checking the longest matching dial
 * code first so e.g. "+64" wins over the (non-existent) "+6". Returns
 * null if no prefix matches.
 *
 * Note: dial codes overlap (US + CA both = +1, KZ + RU both = +7).
 * For overlapping codes we pick the first match in our list — good
 * enough as a default; user can change it in the dropdown.
 */
export function detectCountryFromPhone(phone: string | null | undefined): Country | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return null;
  // Sort by longest dial code first so 3-digit codes match before
  // 2-digit and 1-digit prefixes.
  const byLength = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of byLength) {
    if (digits.startsWith(c.dial)) return c;
  }
  return null;
}
