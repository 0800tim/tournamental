import { NextRequest, NextResponse } from "next/server";

/**
 * Host-based routing for the multi-domain Next app.
 *
 * - `2026wc.tournamental.com` and `wc2026.tournamental.com` are the
 *   World Cup 2026 hype/microsite hosts. Apex (`/`) rewrites to
 *   `/world-cup-2026/landing` (pre-pick marketing flavour), `/match/*`
 *   is redirected to the platform host, everything else falls through.
 *
 * - `play.tournamental.com` is the "play the tournament" host. Apex
 *   (`/`) rewrites straight to the bracket builder at
 *   `/world-cup-2026` so the user lands on the predict surface
 *   immediately. `/match/*` and all other paths fall through (so the
 *   3D watch-along still works at play.tournamental.com/match/...).
 *
 * - Other hosts (e.g. `tournamental.aiva.nz`, `app.tournamental.com`,
 *   the local dev origin) are untouched.
 *
 * Performance: the matcher excludes static asset paths so middleware
 * never runs for flag SVGs, fonts, the renderer's data dumps, etc.
 */

const WC_HOST_PREFIXES = ["2026wc.tournamental.com", "wc2026.tournamental.com"] as const;
const WC_LOCAL_HOSTS = new Set(["2026wc.localhost", "wc2026.localhost"]);

const PLAY_HOSTS = new Set([
  "play.tournamental.com",
  "play.localhost",
]);

function isWcHost(host: string): boolean {
  if (WC_LOCAL_HOSTS.has(host)) return true;
  return WC_HOST_PREFIXES.some((p) => host.startsWith(p));
}

function isPlayHost(host: string): boolean {
  return PLAY_HOSTS.has(host);
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const path = req.nextUrl.pathname;

  if (isPlayHost(host)) {
    // play.tournamental.com — bracket-first landing. Apex rewrites
    // straight to the predict surface; every other route falls through.
    if (path === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/world-cup-2026";
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  if (!isWcHost(host)) return NextResponse.next();

  // 1. /match/* → redirect to the platform host. Replays don't belong on the
  //    WC subdomain. (Existing behaviour from PR #42 — preserved here.)
  if (path.startsWith("/match/")) {
    const target = new URL(`https://app.tournamental.com${path}${req.nextUrl.search}`);
    return NextResponse.redirect(target, 308);
  }

  // 2. Apex `/` → rewrite to the hype landing. Stays on the WC host so the
  //    URL the visitor sees is `https://2026wc.tournamental.com/`.
  if (path === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/world-cup-2026/landing";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every request except static asset routes.
    "/((?!_next/static|_next/image|favicon.ico|flags/|data/|audio/|assets/).*)",
  ],
};
