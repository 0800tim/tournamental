import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  isSupportedLocale,
  pickFromAcceptLanguage,
  type Locale,
} from "./i18n/config";
import { localeForCountry } from "./i18n/country-locale";
import {
  activeTournament,
  archiveForHost,
  archivedTournaments,
} from "./lib/tournaments/registry";

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
  "app.tournamental.com",
]);

/**
 * Archive hostnames (2026-10-16). `wc2026` and `2026wc` used to 301 to
 * play; they are now aliases of the FWC 2026 archive and 301 to the
 * canonical archive host instead, so old links land on the archived
 * tournament rather than the hub.
 */
const ARCHIVE_ALIAS_HOSTS: Record<string, string> = {
  "2026wc.tournamental.com": "fwc2026.tournamental.com",
  "wc2026.tournamental.com": "fwc2026.tournamental.com",
};

/** Request header that tells layouts and components they are serving
 *  a read-only archive. Mirrors lib/archive/server.ts ARCHIVE_HEADER. */
const ARCHIVE_HEADER = "x-tnm-archive";
/** Hub counterpart. Mirrors lib/archive/server.ts HUB_HEADER. */
const HUB_HEADER = "x-tnm-hub";

/**
 * Paths that only make sense for a live tournament. On an archive host
 * they bounce to the archive home: sign-in, profile, pool creation and
 * management, imports, bot keys, the pre-launch landing, invite codes.
 */
const ARCHIVE_BLOCKED_PREFIXES: readonly string[] = [
  "/auth",
  "/profile",
  "/manage",
  "/dashboard",
  "/pools",
  "/syndicates",
  "/import",
  "/run",
  "/bots/keys",
  "/world-cup-2026/landing",
  "/predict",
  "/i/",
  "/leaderboard",
  "/next-stage-r32",
  "/hub",
];

/** On an archive host, /s/<guid>/join is the one nested path we block. */
const ARCHIVE_BLOCKED_PATTERNS: readonly RegExp[] = [/^\/s\/[^/]+\/join$/];

/**
 * API paths whose GET handlers write (the signed approve and deny links
 * that pool owners get by email). The method check below does not see
 * them, so on an archive host they get the same 403 as a POST
 * (review 2026-10-17, RI-07).
 */
const ARCHIVE_BLOCKED_API: readonly RegExp[] = [
  /^\/api\/v1\/syndicates\/[^/]+\/join-requests\//,
];

/**
 * Hub mode (play host with no active tournament): only these paths are
 * served from play itself; everything else 302s to the archive so old
 * share links keep working.
 */
const HUB_ALLOWED_PREFIXES: readonly string[] = [
  "/api/v1/register-interest",
  "/api/healthz",
  "/api/og/",
  "/hub",
  "/rwc2027/",
  "/icons/",
  "/fonts/",
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
  "/sitemap.xml",
  "/whitepaper/",
];

/**
 * CSRF / same-origin guard for state-changing /api/v1/** routes
 * (SEC-WEB-01). The `tnm_session` cookie is `SameSite=None; Secure`
 * (so the embed widget on a partner site can carry it cross-origin),
 * which means a plain SameSite check is not enough — we additionally
 * require the inbound Origin header on every mutating call to be one
 * of a known-good first-party origin.
 *
 * The widget-token mint route + widget-OTP + the bearer-token
 * `/api/v1/syndicates/[slug]/join` flow are EXEMPT: they auth via
 * `Authorization: Bearer ...` (not a cookie) so an attacker can't
 * forge a cross-origin POST in a victim's browser that carries the
 * bearer token — the partner-page widget reads the token from its
 * own first-party localStorage and attaches it explicitly.
 */
const CSRF_ALLOWED_ORIGINS = new Set([
  "https://play.tournamental.com",
  "https://play-dev.tournamental.com",
  "http://localhost:3499",
  "http://localhost:3300",
]);

/** Routes that authenticate via bearer token, not cookies → exempt from
 *  the Origin check. Pattern matches the request pathname. */
const CSRF_EXEMPT_PATHS: ReadonlyArray<RegExp> = [
  /^\/api\/v1\/syndicates\/[^/]+\/join$/,
  /^\/api\/v1\/auth\/widget-token$/,
  /^\/api\/v1\/auth\/widget-otp$/,
];

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function isCsrfExemptPath(path: string): boolean {
  for (const re of CSRF_EXEMPT_PATHS) {
    if (re.test(path)) return true;
  }
  return false;
}

/**
 * Legal pages live on the marketing site (apps/marketing). Anyone who
 * lands on the play app at /terms, /privacy or /cookies gets 301'd to
 * the canonical /legal/<doc> URL on tournamental.com.
 */
const LEGAL_REDIRECT_MAP: Record<string, string> = {
  "/terms": "/legal/terms",
  "/privacy": "/legal/privacy",
  "/cookies": "/legal/cookies",
  "/legal": "/legal",
};

function isPlayHost(host: string): boolean {
  return PLAY_HOSTS.has(host);
}

function isDeprecatedHost(host: string): boolean {
  return DEPRECATED_HOSTS.has(host);
}

/**
 * The path with a leading supported locale prefix removed, so host-mode
 * routing (archive block list, hub allow list, invite links, the `/`
 * rewrites) sees `/es/pools` as `/pools`. Redirect targets keep the
 * original path so the visitor's locale survives the hop. Found by the
 * host-mode tests 2026-10-17: `/fr/leaderboard` was served on the
 * archive host and `/es` on the hub fell through to the archive.
 */
function routePathOf(path: string): string {
  const prefix = path.split("/")[1] ?? "";
  if (!isSupportedLocale(prefix)) return path;
  return path.slice(prefix.length + 1) || "/";
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const path = req.nextUrl.pathname;
  const search = req.nextUrl.search;
  const routePath = routePathOf(path);

  // SEC-WEB-01: Origin/Referer enforcement on mutating /api/v1/** routes.
  // The session cookie is SameSite=None so the browser will attach it on
  // cross-origin POSTs; the Origin header is our only signal that the
  // request actually originated from a first-party surface. Bearer-token
  // widget routes are exempted (they don't rely on cookie creds).
  if (
    routePath.startsWith("/api/v1/") &&
    MUTATING_METHODS.has(req.method) &&
    !isCsrfExemptPath(routePath)
  ) {
    const origin = req.headers.get("origin");
    if (!origin || !CSRF_ALLOWED_ORIGINS.has(origin)) {
      return new NextResponse(
        JSON.stringify({ error: "bad_origin" }),
        {
          status: 403,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        },
      );
    }
  }

  // Deprecated WC hosts → 301 to play.tournamental.com (preserve path + query).
  if (isDeprecatedHost(host)) {
    const target = new URL(`https://play.tournamental.com${path}${search}`);
    return NextResponse.redirect(target, 301);
  }

  // Archive aliases → 301 to the canonical archive host.
  const aliasTarget = ARCHIVE_ALIAS_HOSTS[host];
  if (aliasTarget) {
    return NextResponse.redirect(new URL(`https://${aliasTarget}${path}${search}`), 301);
  }

  // ---- Archive mode: read-only past tournament on its own hostname ----
  const archive = archiveForHost(host);
  if (archive) {
    // Nothing mutates in an archive. 403 every state-changing call
    // (bracket saves go to the game service directly and are rejected
    // there after kickoff; this covers the Next-side routes).
    // Review 336-1: test the locale-stripped path too, or /es/api/v1/...
    // walks past the block and the locale rewrite runs the handler.
    const localePrefix = path.split("/")[1] ?? "";
    const apiPath = isSupportedLocale(localePrefix) ? path.slice(localePrefix.length + 1) || "/" : path;
    if (MUTATING_METHODS.has(req.method) || ARCHIVE_BLOCKED_API.some((re) => re.test(apiPath))) {
      return new NextResponse(JSON.stringify({ error: "archived" }), {
        status: 403,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    const legalRedirect = LEGAL_REDIRECT_MAP[routePath];
    if (legalRedirect) {
      return NextResponse.redirect(new URL(`https://tournamental.com${legalRedirect}${search}`), 301);
    }
    if (
      ARCHIVE_BLOCKED_PREFIXES.some(
        (p) => routePath === p || routePath.startsWith(p.endsWith("/") ? p : `${p}/`),
      ) ||
      ARCHIVE_BLOCKED_PATTERNS.some((re) => re.test(routePath))
    ) {
      return NextResponse.redirect(new URL(`https://${host}/`), 302);
    }
    const extra = new Headers();
    extra.set(ARCHIVE_HEADER, archive.slug);
    if (routePath === "/") {
      return withLocaleHint(req, extra, "/archive");
    }
    return withLocaleHint(req, extra);
  }

  // ---- Hub mode: play host with no active tournament ----
  if (isPlayHost(host) && !activeTournament()) {
    const legalRedirect = LEGAL_REDIRECT_MAP[routePath];
    if (legalRedirect) {
      return NextResponse.redirect(new URL(`https://tournamental.com${legalRedirect}${search}`), 301);
    }
    const hubHeaders = new Headers();
    hubHeaders.set(HUB_HEADER, "1");
    if (routePath === "/") {
      return withLocaleHint(req, hubHeaders, "/hub");
    }
    // Personal invite links (referral loop): /i/<code> → hub with ?ref=.
    const inviteMatch = /^\/i\/([a-z0-9]{4,16})$/i.exec(routePath);
    if (inviteMatch) {
      // Keep the visitor's locale prefix on the hop (review 335-2).
      const localeSeg = path === routePath ? "" : path.slice(0, path.length - routePath.length);
      const u = new URL(`https://${host}${localeSeg}/`);
      u.searchParams.set("ref", inviteMatch[1]!.toLowerCase());
      return NextResponse.redirect(u, 302);
    }
    const allowed =
      HUB_ALLOWED_PREFIXES.some((p) => routePath === p || routePath.startsWith(p)) ||
      /\.[a-z0-9]{2,5}$/i.test(routePath); // static files (svg, png, css, js, json)
    if (!allowed) {
      // Everything else belongs to the most recent archive so old share
      // links, pool pages and bookmarks keep resolving.
      const latest = archivedTournaments()[archivedTournaments().length - 1];
      const archiveHost = latest?.archiveHost ?? "fwc2026.tournamental.com";
      return NextResponse.redirect(new URL(`https://${archiveHost}${path}${search}`), 302);
    }
    return withLocaleHint(req, hubHeaders);
  }

  if (isPlayHost(host)) {
    // Legal pages live on the marketing site (apps/marketing). When a
    // user lands on play.tournamental.com/terms (linked from the
    // syndicate signup, the legal-block footer, etc.) we 301 across
    // to the canonical /legal/<doc> URL on tournamental.com. Tim
    // 2026-05-24: the bare /terms link from /syndicates/new was 404'ing
    // because no terms page exists in the play app.
    const legalRedirect = LEGAL_REDIRECT_MAP[path];
    if (legalRedirect) {
      return NextResponse.redirect(
        new URL(`https://tournamental.com${legalRedirect}${search}`),
        301,
      );
    }
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
function withLocaleHint(
  req: NextRequest,
  extraRequestHeaders?: Headers,
  rewriteTo?: string,
): NextResponse {
  const path = req.nextUrl.pathname;
  const search = req.nextUrl.search;
  const prefix = path.split("/")[1] ?? "";
  const fromPrefix: Locale | null = isSupportedLocale(prefix) ? prefix : null;
  const cookie = req.cookies.get("vt_locale")?.value;
  const fromCookie: Locale | null = isSupportedLocale(cookie) ? cookie : null;

  // URL-prefix routing: when the path is /<supported-locale>/<rest>,
  // (a) write the cookie so it sticks for subsequent un-prefixed visits,
  // (b) rewrite the request internally to /<rest> so we don't need a
  //     duplicated `app/[locale]/` route tree. The page that renders is
  //     identical to the bare URL, but getRequestConfig reads the cookie
  //     we just stamped and ships the matching catalogue.
  //
  // Browsers retain the visible /<locale>/<rest> in the URL bar, which
  // makes deep-linking ("share my Spanish bracket") work.
  if (fromPrefix) {
    // Archive and hub pass an explicit page (/archive, /hub) for the
    // bare locale root; otherwise serve the un-prefixed path.
    const rewrittenPath = rewriteTo ?? (path.slice(fromPrefix.length + 1) || "/");
    const rewriteUrl = new URL(req.url);
    rewriteUrl.pathname = rewrittenPath;
    // Forward the locale to downstream server components via BOTH a
    // request header (so getRequestConfig sees it this request) AND
    // the response cookie (so future bare-URL visits keep the lang).
    // Without the header path, the rewrite would arrive at the RSC
    // with the visitor's pre-existing cookie value (or none), and
    // getMessages() would ship the wrong catalogue, producing a
    // visible "I picked Spanish and got English" bug -- exactly what
    // Tim saw 2026-05-24.
    const reqHeaders = new Headers(req.headers);
    extraRequestHeaders?.forEach((v, k) => reqHeaders.set(k, v));
    reqHeaders.set("x-vt-locale", fromPrefix);
    // Patch the Cookie header too so libs that read cookies via the
    // raw header (rather than next/headers cookies()) also see the
    // current pick.
    const existingCookie = reqHeaders.get("cookie") ?? "";
    const stripped = existingCookie
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c && !c.startsWith("vt_locale="))
      .join("; ");
    reqHeaders.set(
      "cookie",
      stripped ? `${stripped}; vt_locale=${fromPrefix}` : `vt_locale=${fromPrefix}`,
    );
    const res = NextResponse.rewrite(rewriteUrl, {
      request: { headers: reqHeaders },
    });
    res.cookies.set("vt_locale", fromPrefix, {
      path: "/",
      domain: ".tournamental.com",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: true,
    });
    return res;
  }

  // Archive / hub requests carry extra request headers (and may be
  // internally rewritten to a different page) without a locale prefix.
  let res: NextResponse;
  if (extraRequestHeaders || rewriteTo) {
    const reqHeaders = new Headers(req.headers);
    extraRequestHeaders?.forEach((v, k) => reqHeaders.set(k, v));
    if (rewriteTo) {
      const rewriteUrl = new URL(req.url);
      rewriteUrl.pathname = rewriteTo;
      res = NextResponse.rewrite(rewriteUrl, { request: { headers: reqHeaders } });
    } else {
      res = NextResponse.next({ request: { headers: reqHeaders } });
    }
  } else {
    res = NextResponse.next();
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
