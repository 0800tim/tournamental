import { NextRequest, NextResponse } from "next/server";

/**
 * Host-based routing for the multi-domain Next app.
 *
 * - `2026wc.vtourn.com` and `wc2026.vtourn.com` are the World Cup 2026 brand.
 *   On those hosts:
 *     1. The apex (`/`) serves the WC 2026 hype/marketing landing (a rewrite
 *        to `/world-cup-2026/landing` so the URL stays clean).
 *     2. `/match/*` is redirected to `app.vtourn.com/match/*` so the AR-FR
 *        replay (and any other historical replay) lives on the platform host,
 *        never on the tournament-specific subdomain.
 *     3. Everything else (notably `/world-cup-2026` — the bracket builder)
 *        falls through unchanged.
 *
 * - Other hosts (e.g. `vtourn.aiva.nz`, the renderer landing) are untouched.
 *
 * Performance: the matcher excludes static asset paths so middleware never
 * runs for flag SVGs, fonts, the renderer's data dumps, etc. A typical
 * navigation request is two host-string checks and at most one URL clone.
 */

const WC_HOST_PREFIXES = ["2026wc.vtourn.com", "wc2026.vtourn.com"] as const;
// Convenience aliases for local + preview environments. Anything else is
// left alone, so the renderer landing keeps working in dev.
const WC_LOCAL_HOSTS = new Set(["2026wc.localhost", "wc2026.localhost"]);

function isWcHost(host: string): boolean {
  if (WC_LOCAL_HOSTS.has(host)) return true;
  return WC_HOST_PREFIXES.some((p) => host.startsWith(p));
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (!isWcHost(host)) return NextResponse.next();

  const path = req.nextUrl.pathname;

  // 1. /match/* → redirect to the platform host. Replays don't belong on the
  //    WC subdomain. (Existing behaviour from PR #42 — preserved here.)
  if (path.startsWith("/match/")) {
    const target = new URL(`https://app.vtourn.com${path}${req.nextUrl.search}`);
    return NextResponse.redirect(target, 308);
  }

  // 2. Apex `/` → rewrite to the hype landing. Stays on the WC host so the
  //    URL the visitor sees is `https://2026wc.vtourn.com/`.
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
