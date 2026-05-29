/**
 * Country-gate helpers, the small pure layer that the schema, the
 * persistence write path, the join API, and the directory all share.
 *
 * Storage format: bare dial codes separated by commas, no plus, no
 * spaces. Examples: "64" = NZ only, "64,61" = NZ + AU. NULL or empty
 * = no restriction (open to all). The DB column
 * `syndicates.allowed_phone_countries` is `TEXT NULL` for this.
 *
 * Lookup time is O(n*m) where n is the allow-list size (max ~10) and
 * m is the average dial-code length (1 to 4). Fine for the join hot
 * path; no caching needed.
 */

import { COUNTRIES, type CountryEntry } from "./countries";

/** Max number of countries a single pool may allow. Mirrors the Zod
 * schema; surfaced here so the UI's add-country button can disable
 * at the same threshold without duplicating the literal. */
export const MAX_ALLOWED_COUNTRIES = 10;

/** Strict shape for a single bare dial code in the allow-list. Used
 * by the Zod schema AND by parseAllowedCountries to filter junk. */
const DIAL_CODE_RE = /^[1-9]\d{0,3}$/;

/**
 * Decode the CSV stored in `syndicates.allowed_phone_countries` to an
 * array of bare dial codes. Non-matching tokens are filtered out
 * defensively so a hand-edited DB row can never crash a render.
 *
 * Empty array means "no restriction" — the join API treats it as
 * open. We deliberately return [] (not null) so the public DTO is
 * always an array, which simplifies consumers.
 */
export function parseAllowedCountries(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => DIAL_CODE_RE.test(s));
}

/**
 * Canonicalise an array of dial codes to the storage CSV string.
 * Strips non-digits, dedupes (preserving first-seen order), drops
 * blanks. Returns NULL when the result is empty so the DB stores
 * NULL rather than an empty string, keeping "no restriction" a
 * single sentinel.
 */
export function serialiseAllowedCountries(arr: readonly string[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const cleaned = String(raw).replace(/\D/g, "");
    if (!cleaned || !DIAL_CODE_RE.test(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out.length > 0 ? out.join(",") : null;
}

/**
 * Does a verified E.164 phone number satisfy the allow-list?
 *
 *  - Empty allow-list returns true (no restriction).
 *  - Phone without the leading "+" returns false (defensive; the
 *    persistence + auth layers should never give us anything else,
 *    but we don't want a corrupted session to bypass the gate).
 *  - Otherwise we check each dial-code prefix in turn. Longer prefixes
 *    are tried first so that, in any hypothetical future where two
 *    countries share a prefix (e.g. "44" vs "441" for Bermuda), the
 *    more specific one wins.
 */
export function phoneMatchesAllowed(
  phoneE164: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (allowed.length === 0) return true;
  if (!phoneE164 || !phoneE164.startsWith("+")) return false;
  const digits = phoneE164.slice(1).replace(/\D/g, "");
  if (!digits) return false;
  const sorted = [...allowed].sort((a, b) => b.length - a.length);
  return sorted.some((dial) => digits.startsWith(dial));
}

/** Map a stored allow-list to the full CountryEntry shapes the UI
 * needs to render flags + names. Skips unknown codes silently so a
 * future country added to the DB before the shared list catches up
 * doesn't crash a render. */
export function countriesFromAllowed(allowed: readonly string[]): CountryEntry[] {
  const out: CountryEntry[] = [];
  for (const dial of allowed) {
    const country = COUNTRIES.find(
      (c) => c.dial.replace(/^\+/, "") === dial,
    );
    if (country) out.push(country);
  }
  return out;
}
