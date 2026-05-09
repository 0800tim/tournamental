import { NextRequest, NextResponse } from "next/server";

/**
 * Host-based routing for the multi-domain Next app.
 *
 * - `2026wc.vtourn.com` and `wc2026.vtourn.com` are the World Cup 2026 brand.
 *   They host the bracket / hype experience. Any `/match/*` URL on those hosts
 *   is redirected to `app.vtourn.com/match/*` so the AR-FR replay (and any
 *   other historical replay) lives on the platform host, never on the
 *   tournament-specific subdomain.
 *
 * The hype landing for `2026wc.vtourn.com/` apex rewrite is added in a
 * follow-up commit by the hype-landing builder.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  const isWcHost = host.startsWith("2026wc.vtourn.com") || host.startsWith("wc2026.vtourn.com");
  const path = req.nextUrl.pathname;

  if (isWcHost && path.startsWith("/match/")) {
    const target = new URL(`https://app.vtourn.com${path}${req.nextUrl.search}`);
    return NextResponse.redirect(target, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every request except static asset routes.
    "/((?!_next/static|_next/image|favicon.ico|flags/|data/|audio/|assets/).*)",
  ],
};
