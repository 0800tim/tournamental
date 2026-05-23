/**
 * Canonical i18n configuration for play.tournamental.com.
 *
 * Single source of truth for:
 *   - The supported locale list (the same 22 codes used across the
 *     middleware, the LocalePicker, the OG card endpoints, and the
 *     contributor-facing validator).
 *   - Per-locale metadata (native name, English name, flag emoji,
 *     RTL flag, plural rules) so the UI doesn't have to scatter
 *     this information across 22 places.
 *   - The fallback locale (always `en`).
 *
 * Why a separate file: the middleware (Edge runtime) needs the
 * locale list and the country mapping; the LocalePicker (client
 * component) needs the metadata; the validator script needs all
 * of it. Co-locating in one config file means changing the
 * catalogue is a one-line edit. Adding a locale (e.g. Welsh) is:
 *
 *   1. Add the new entry to LOCALES below.
 *   2. Create the JSON file at apps/web/locales/<code>.json.
 *   3. PR.
 *
 * See docs/60-i18n-architecture.md for the full plan.
 */

export type Locale =
  | "en"
  | "es"
  | "pt-BR"
  | "pt-PT"
  | "fr"
  | "de"
  | "it"
  | "nl"
  | "ja"
  | "ko"
  | "ar"
  | "zh-CN"
  | "fa"
  | "tr"
  | "hr"
  | "bs"
  | "cs"
  | "sv"
  | "no"
  | "uz"
  | "hu"
  | "mi";

export interface LocaleMeta {
  /** ISO-style locale code used in URL prefixes + cookies + filenames. */
  readonly code: Locale;
  /** Endonym (how speakers refer to their own language). */
  readonly native: string;
  /** English name for the dropdown's secondary line. */
  readonly english: string;
  /** Single-flag emoji for the dropdown chip. Picked to evoke the
   * locale's dominant home country; multi-country locales use the
   * most populous speaker base. */
  readonly flag: string;
  /** Layout direction; true → write the response HTML with dir="rtl". */
  readonly rtl: boolean;
  /** Region grouping for the dropdown's sectioned list. */
  readonly region:
    | "americas"
    | "europe"
    | "asia-pacific"
    | "middle-east-africa";
}

/**
 * The 22 supported locales. Order is the visible order in the
 * dropdown (region-clustered + English first). The validator script
 * uses LOCALES as the canonical list when comparing key coverage.
 */
export const LOCALES: readonly LocaleMeta[] = [
  { code: "en", native: "English", english: "English", flag: "🇬🇧", rtl: false, region: "europe" },

  // Americas
  { code: "es", native: "Español", english: "Spanish", flag: "🇲🇽", rtl: false, region: "americas" },
  { code: "pt-BR", native: "Português (Brasil)", english: "Portuguese (Brazil)", flag: "🇧🇷", rtl: false, region: "americas" },
  { code: "pt-PT", native: "Português (Portugal)", english: "Portuguese (Portugal)", flag: "🇵🇹", rtl: false, region: "europe" },

  // Europe
  { code: "fr", native: "Français", english: "French", flag: "🇫🇷", rtl: false, region: "europe" },
  { code: "de", native: "Deutsch", english: "German", flag: "🇩🇪", rtl: false, region: "europe" },
  { code: "it", native: "Italiano", english: "Italian", flag: "🇮🇹", rtl: false, region: "europe" },
  { code: "nl", native: "Nederlands", english: "Dutch", flag: "🇳🇱", rtl: false, region: "europe" },
  { code: "hr", native: "Hrvatski", english: "Croatian", flag: "🇭🇷", rtl: false, region: "europe" },
  { code: "bs", native: "Bosanski", english: "Bosnian", flag: "🇧🇦", rtl: false, region: "europe" },
  { code: "cs", native: "Čeština", english: "Czech", flag: "🇨🇿", rtl: false, region: "europe" },
  { code: "sv", native: "Svenska", english: "Swedish", flag: "🇸🇪", rtl: false, region: "europe" },
  { code: "no", native: "Norsk", english: "Norwegian", flag: "🇳🇴", rtl: false, region: "europe" },
  { code: "hu", native: "Magyar", english: "Hungarian", flag: "🇭🇺", rtl: false, region: "europe" },

  // Asia-Pacific
  { code: "ja", native: "日本語", english: "Japanese", flag: "🇯🇵", rtl: false, region: "asia-pacific" },
  { code: "ko", native: "한국어", english: "Korean", flag: "🇰🇷", rtl: false, region: "asia-pacific" },
  { code: "zh-CN", native: "中文（简体）", english: "Chinese (Simplified)", flag: "🇨🇳", rtl: false, region: "asia-pacific" },
  { code: "uz", native: "Oʻzbekcha", english: "Uzbek", flag: "🇺🇿", rtl: false, region: "asia-pacific" },
  { code: "mi", native: "Te Reo Māori", english: "Māori", flag: "🇳🇿", rtl: false, region: "asia-pacific" },

  // Middle East + Africa
  { code: "ar", native: "العربية", english: "Arabic", flag: "🇸🇦", rtl: true, region: "middle-east-africa" },
  { code: "fa", native: "فارسی", english: "Persian", flag: "🇮🇷", rtl: true, region: "middle-east-africa" },
  { code: "tr", native: "Türkçe", english: "Turkish", flag: "🇹🇷", rtl: false, region: "middle-east-africa" },
];

export const LOCALE_CODES: readonly Locale[] = LOCALES.map((l) => l.code);

export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (LOCALE_CODES as readonly string[]).includes(value)
  );
}

export function localeMeta(code: Locale): LocaleMeta {
  const found = LOCALES.find((l) => l.code === code);
  // Defensive: every Locale has a matching entry; this should never throw.
  if (!found) throw new Error(`No metadata for locale "${code}"`);
  return found;
}

/** Best-effort match of a user-supplied Accept-Language header against
 * our supported set. Strips region tags when no exact match is found
 * (so a browser asking for `pt-AO` falls through to `pt-PT`). Returns
 * null when nothing in the header matches the supported set. */
export function pickFromAcceptLanguage(
  header: string,
  supported: readonly Locale[] = LOCALE_CODES,
): Locale | null {
  // Parse the header per RFC 7231 § 5.3.5 with q-values; lower q means
  // lower preference. Default q is 1.
  const parts = header
    .split(",")
    .map((p) => {
      const [tagRaw, ...params] = p.trim().split(";");
      const tag = (tagRaw ?? "").trim();
      if (!tag) return null;
      let q = 1;
      for (const param of params) {
        const m = /^q=([\d.]+)$/.exec(param.trim());
        if (m) q = parseFloat(m[1] ?? "1");
      }
      return { tag, q };
    })
    .filter((x): x is { tag: string; q: number } => x !== null)
    .sort((a, b) => b.q - a.q);
  for (const part of parts) {
    // Exact match first.
    const exact = supported.find((s) => s.toLowerCase() === part.tag.toLowerCase());
    if (exact) return exact;
    // Region-stripped fallback (pt-AO → pt → pt-PT? Pick the first
    // supported locale that shares the language tag).
    const lang = part.tag.split("-")[0]?.toLowerCase();
    if (!lang) continue;
    const fuzzy = supported.find((s) => s.toLowerCase().startsWith(lang));
    if (fuzzy) return fuzzy;
  }
  return null;
}
