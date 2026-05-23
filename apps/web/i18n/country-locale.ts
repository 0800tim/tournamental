/**
 * ISO 3166-1 alpha-2 country code → preferred locale.
 *
 * Read by `apps/web/middleware.ts` to resolve the auto-detect step
 * of the i18n resolution chain (URL prefix → cookie → THIS TABLE →
 * Accept-Language → en).
 *
 * Multi-language country defaults:
 *
 *   - Canada (CA) → en. Quebec users hit the LocalePicker for fr.
 *   - Switzerland (CH) → de. Romandy users pick fr; Ticino picks it.
 *   - Belgium (BE) → nl. Wallonia users pick fr.
 *   - New Zealand (NZ) → en. Māori speakers pick mi.
 *   - India / Pakistan / etc. → en (English is the lingua franca
 *     and we don't ship Hindi/Urdu yet; a future PR welcome).
 *
 * Coverage: every nation qualified for FIFA World Cup 2026™, plus
 * the catch-all defaults for major non-qualified markets. Countries
 * not in the table fall through to the Accept-Language step in the
 * middleware.
 */

import type { Locale } from "./config.js";

export const COUNTRY_LOCALE: Readonly<Record<string, Locale>> = {
  // Americas (Spanish)
  AR: "es", // Argentina
  CL: "es",
  CO: "es",
  CR: "es",
  CU: "es",
  DO: "es",
  EC: "es",
  GT: "es",
  HN: "es",
  MX: "es",
  NI: "es",
  PA: "es",
  PE: "es",
  PR: "es",
  PY: "es",
  SV: "es",
  UY: "es",
  VE: "es",
  BO: "es",

  // Americas (Portuguese / French / Dutch / English)
  BR: "pt-BR",
  HT: "fr",
  CW: "nl",
  CA: "en", // Quebec switches via dropdown
  US: "en",
  JM: "en",
  TT: "en",

  // Europe
  ES: "es",
  PT: "pt-PT",
  FR: "fr",
  DE: "de",
  AT: "de",
  CH: "de", // Romandy + Ticino switch via dropdown
  IT: "it",
  NL: "nl",
  BE: "nl", // Wallonia switches via dropdown
  HR: "hr",
  BA: "bs",
  CZ: "cs",
  SE: "sv",
  NO: "no",
  HU: "hu",
  GB: "en",
  IE: "en",
  IS: "en", // until a Icelandic translator lands
  PL: "en", // until a Polish translator lands
  DK: "en", // ditto Danish
  FI: "en", // ditto Finnish

  // Asia-Pacific
  JP: "ja",
  KR: "ko",
  CN: "zh-CN",
  HK: "zh-CN",
  TW: "zh-CN",
  MO: "zh-CN",
  SG: "en",
  MY: "en",
  PH: "en",
  ID: "en",
  TH: "en",
  VN: "en",
  IN: "en",
  PK: "en",
  BD: "en",
  LK: "en",
  UZ: "uz",
  KZ: "en",
  AU: "en",
  NZ: "en", // Māori speakers switch via dropdown
  FJ: "en",

  // Middle East + Africa
  SA: "ar",
  EG: "ar",
  MA: "ar",
  DZ: "ar",
  TN: "ar",
  IQ: "ar",
  JO: "ar",
  QA: "ar",
  AE: "ar",
  KW: "ar",
  BH: "ar",
  OM: "ar",
  YE: "ar",
  LB: "ar",
  SY: "ar",
  LY: "ar",
  SD: "ar",
  IR: "fa",
  TR: "tr",
  CV: "pt-PT",
  CI: "fr", // Côte d'Ivoire
  SN: "fr", // Senegal
  CD: "fr", // DR Congo
  GH: "en",
  ZA: "en",
  NG: "en",
  KE: "en",
  TZ: "en",
  UG: "en",
};

/** Resolve a CF-IPCountry header value to a locale, or null when the
 * country is not in the table. Two-letter codes only (per Cloudflare). */
export function localeForCountry(cc: string | null | undefined): Locale | null {
  if (!cc) return null;
  const key = cc.trim().toUpperCase();
  return COUNTRY_LOCALE[key] ?? null;
}
