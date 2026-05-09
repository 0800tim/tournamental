/**
 * Edge middleware: gates every route behind the admin session cookie
 * except /login and /api/auth/*.
 *
 * Note: we don't crypto-verify the JWT here (that would require importing
 * `jose` into the edge runtime, which we do at the route handler level).
 * Middleware just checks the cookie *exists*, then leaves verification to
 * the server component / route handler that actually reads the session.
 * Anything else would create a "soft auth" foot-gun: an unverified cookie
 * would feel like auth and isn't.
 */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-admin" : "admin-session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/request",
  "/api/auth/callback",
  "/api/auth/logout",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Pass the originally-requested path along so requireAuth can preserve it.
  const res = NextResponse.next();
  res.headers.set("x-admin-path", pathname);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
