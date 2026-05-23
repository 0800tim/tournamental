/**
 * next-intl request configuration.
 *
 * Resolves the visitor's locale from the cookie / header chain set in
 * middleware.ts and loads the matching message catalogue from
 * apps/web/locales/<code>.json. The locale is NOT in the URL (Phase 1
 * routing decision), so we read the `vt_locale` cookie server-side
 * each request.
 *
 * Falls back to English if:
 *   - Cookie is missing.
 *   - Cookie value isn't in our supported set.
 *   - The matching JSON file fails to load (defensive, shouldn't happen).
 */

import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  pickFromAcceptLanguage,
  type Locale,
} from "./config";
import { localeForCountry } from "./country-locale";

type Messages = Record<string, string>;

async function loadMessages(locale: Locale): Promise<Messages> {
  try {
    const mod = await import(`../locales/${locale}.json`);
    return (mod.default ?? mod) as Messages;
  } catch {
    if (locale !== DEFAULT_LOCALE) {
      const fallback = await import(`../locales/${DEFAULT_LOCALE}.json`);
      return (fallback.default ?? fallback) as Messages;
    }
    return {} as Messages;
  }
}

function resolveLocale(): Locale {
  const cookieStore = cookies();
  const fromCookie = cookieStore.get("vt_locale")?.value;
  if (isSupportedLocale(fromCookie)) return fromCookie;

  const h = headers();
  const cf = h.get("cf-ipcountry");
  const fromCountry = localeForCountry(cf);
  if (fromCountry) return fromCountry;

  const accept = h.get("accept-language") ?? "";
  const fromAccept = pickFromAcceptLanguage(accept);
  if (fromAccept) return fromAccept;

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = resolveLocale();
  const messages = await loadMessages(locale);
  return { locale, messages };
});
