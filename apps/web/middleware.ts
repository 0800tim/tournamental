import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  isSupportedLocale,
  pickFromAcceptLanguage,
  type Locale,
} from "./i18n/config";
import { localeForCountry } from "./i18n/country-locale";

/**
 * Host-based routing for the multi-domain Next app.
 *
 * **Canonical play surface**: `play.tournamental.com`. Apex `/` renders
 * the sales-flow home page (hero → step 1 picks → step 2 3D molecule →
 * step 3 syndicates → quickstart). Each step CTAs into the relevant
 * route (`/world-cup-2026` for picks, `/match/<demo>` for the molecule,
 * `/syndicates` for the embed widget).
 *
 * **Deprecated hosts → 301 redirects** (Tim consolidated 2026-05-11
 * to minimise subdomains):
 *   - `2026wc.tournamental.com/*`   → `play.tournamental.com/*`
 *   - `wc2026.tournamental.com/*`   → `play.tournamental.com/*`
 *   - `app.tournamental.com/*`      → `play.tournamental.com/*`
 *
 * The deprecated hostnames keep resolving for now via the existing
 * tunnel ingress + DNS so external links / bookmarks / search-result
 * caches don't break. After ~30 days we can quietly retire them.
 *
 * **Untouched hosts**: `tournamental.com` / `www.tournamental.com`
 * (marketing, separate Astro app), `dev.tournamental.com` (staging),
 * `stream.tournamental.com` (WebSocket producer), the local dev
 * origin, and `tournamental.com` (legacy alias kept alive during
 * the rebrand transition).
 *
 * Performance: the matcher excludes static asset paths so middleware
 * never runs for flag SVGs, fonts, the renderer's data dumps, etc.
 */

const PLAY_HOSTS = new Set([
  "play.tournamental.com",
  "play.localhost",
]);

const DEPRECATED_HOSTS = new Set([
  "2026wc.tournamental.com",
  "wc2026.tournamental.com",
  "app.tournamental.com",
]);

function isPlayHost(host: string): boolean {
  return PLAY_HOSTS.has(host);
}

function isDeprecatedHost(host: string): boolean {
  return DEPRECATED_HOSTS.has(host);
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const path = req.nextUrl.pathname;
  const search = req.nextUrl.search;

  // Deprecated WC hosts → 301 to play.tournamental.com (preserve path + query).
  if (isDeprecatedHost(host)) {
    const target = new URL(`https://play.tournamental.com${path}${search}`);
    return NextResponse.redirect(target, 301);
  }

  if (isPlayHost(host)) {
    // Apex `/` renders the sales-flow home (apps/web/app/page.tsx) —
    // the previous rewrite to /world-cup-2026 was removed 2026-05-13
    // so the home page can front-and-centre syndicates, the 3D
    // molecule, and the picks CTA without burying them under the
    // bracket builder.
    return withLocaleHint(req);
  }

  return withLocaleHint(req);
}

/**
 * Phase 1 i18n middleware: resolve the visitor's preferred locale
 * from the detection chain and stamp it into a cookie so client
 * components can pick it up on the next paint. Does NOT yet rewrite
 * URLs to the locale-prefixed form; that wiring lands in Phase 2
 * once next-intl is fully integrated and every page consumes the
 * translation hooks. Until then, this gives us:
 *
 *   - A `vt_locale` cookie set on first visit based on CF-IPCountry
 *     + Accept-Language, so the LocalePicker shows the right
 *     pre-selection.
 *   - A non-destructive layer the rest of the chain can lean on.
 *
 * The detection chain (per docs/60-i18n-architecture.md):
 *
 *   1. URL prefix (/fr/...) — written through to the cookie.
 *   2. Existing vt_locale cookie — wins; we don't override user choice.
 *   3. CF-IPCountry → locale via country-locale.ts.
 *   4. Accept-Language header.
 *   5. en.
 *
 * Tim 2026-05-24.
 */
function withLocaleHint(req: NextRequest): NextResponse {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;
  const prefix = path.split("/")[1] ?? "";
  const fromPrefix: Locale | null = isSupportedLocale(prefix) ? prefix : null;
  const cookie = req.cookies.get("vt_locale")?.value;
  const fromCookie: Locale | null = isSupportedLocale(cookie) ? cookie : null;

  if (fromPrefix && fromCookie !== fromPrefix) {
    // URL is the source of truth when it's prefixed; keep the
    // cookie in sync so the next bare-URL visit gets the same lang.
    res.cookies.set("vt_locale", fromPrefix, {
      path: "/",
      domain: ".tournamental.com",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: true,
    });
    return res;
  }
  if (fromCookie) return res;

  // Auto-detect for the first visit.
  const cf = req.headers.get("cf-ipcountry");
  const fromCountry = localeForCountry(cf);
  const accept = req.headers.get("accept-language") ?? "";
  const fromAccept = pickFromAcceptLanguage(accept, LOCALE_CODES);
  const resolved: Locale = fromCountry ?? fromAccept ?? DEFAULT_LOCALE;

  if (resolved !== DEFAULT_LOCALE) {
    // Only set the cookie when we picked something non-default so a
    // visitor in an English-speaking country doesn't accumulate a
    // redundant cookie on every visit.
    res.cookies.set("vt_locale", resolved, {
      path: "/",
      domain: ".tournamental.com",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: true,
    });
  }
  return res;
}

export const config = {
  matcher: [
    // Run on every request except static asset routes.
    "/((?!_next/static|_next/image|favicon.ico|flags/|data/|audio/|assets/).*)",
  ],
};
