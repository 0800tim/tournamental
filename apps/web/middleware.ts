import { NextRequest, NextResponse } from "next/server";

/**
 * Host-based routing for the multi-domain Next app.
 *
 * **Canonical play surface**: `play.tournamental.com`. Apex `/`
 * rewrites internally to `/world-cup-2026` (the featured tournament)
 * so the user lands on the bracket builder immediately. Every other
 * path falls through, `/match/<id>`, `/world-cup-2026/molecule`,
 * `/profile`, etc. all work transparently.
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
 * origin, and `tournamental.aiva.nz` (legacy alias kept alive during
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
    // Apex `/` → rewrite to the featured tournament's bracket builder.
    // (Internal rewrite, not redirect: the URL the user sees stays
    // `https://play.tournamental.com/`.) Future tournaments will swap
    // this pointer; the route hierarchy is multi-tournament-ready.
    if (path === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/world-cup-2026";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every request except static asset routes.
    "/((?!_next/static|_next/image|favicon.ico|flags/|data/|audio/|assets/).*)",
  ],
};
