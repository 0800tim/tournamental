/**
 * Detect the admin's country for the "Lock entries to my country"
 * toggle in the create / edit form. Two-source detection:
 *
 *   1. Cloudflare `CF-IPCountry` header (ISO-2). The marketing edge
 *      already forwards this; server components read it from
 *      `headers().get('cf-ipcountry')` and pass it down as a prop.
 *      Most accurate for VPN-less visits.
 *   2. The admin's verified phone country code (parsed from their
 *      E.164 owner_phone). Always present at form-render time for
 *      an authenticated admin.
 *
 *   Fallback to NZ since Tournamental is NZ-headquartered and the
 *   bulk of pool admins are NZ-based in v1.
 *
 * The detected country is shown in the toggle label and pre-selected
 * as the first allow-list chip when the toggle is flipped on; it is
 * NEVER auto-applied without an explicit tick. We bias toward
 * visibility, not coercion.
 */

import {
  type CountryEntry,
  COUNTRIES,
  bareDialCode,
  countryByIso,
} from "./countries";

const FALLBACK_COUNTRY: CountryEntry =
  countryByIso("NZ") ?? {
    iso: "NZ",
    dial: "+64",
    name: "New Zealand",
    flag: "🇳🇿",
  };

export function detectAdminCountry(input: {
  /** Cloudflare CF-IPCountry header value (ISO-2). */
  cfIpCountry?: string | null;
  /** Authenticated admin's E.164 phone, e.g. "+64211234567". */
  ownerPhoneE164?: string | null;
}): CountryEntry {
  const iso = (input.cfIpCountry ?? "").trim().toUpperCase();
  const fromCf = countryByIso(iso);
  if (fromCf) return fromCf;

  const phone = (input.ownerPhoneE164 ?? "").trim();
  if (phone.startsWith("+")) {
    const digits = phone.slice(1).replace(/\D/g, "");
    // Try longest dial code prefixes first so e.g. "+353..." picks IE
    // rather than nothing-matches.
    const sorted = [...COUNTRIES].sort(
      (a, b) => bareDialCode(b.dial).length - bareDialCode(a.dial).length,
    );
    const match = sorted.find((c) => digits.startsWith(bareDialCode(c.dial)));
    if (match) return match;
  }

  return FALLBACK_COUNTRY;
}
