/**
 * Edge middleware: gates every route behind the admin session cookie
 * except /login and /api/auth/*.
 *
 * UI routes: cookie presence check + redirect-to-/login on miss. We do
 * NOT crypto-verify the JWT here for UI routes; the server component
 * still calls `requireAuth()` which does the full `jwtVerify` + allowlist
 * recheck. The redirect-on-miss is just a UX shortcut so a logged-out
 * visitor lands at /login instead of an unmounted page.
 *
 * API routes (`/api/**` except `/api/auth/*`): we DO crypto-verify here.
 * Previously the middleware only checked cookie *presence* and trusted
 * each route handler to call `readSession()`. That left a foot-gun: a
 * new route that forgot to call `readSession()` would still see the
 * cookie and could leak data. Verifying in middleware closes that gap
 * without requiring every handler to opt-in. Tracked: SEC-ADMIN-04.
 *
 * `jose` runs in the edge runtime, so verifying with `jwtVerify` here
 * is safe. We do NOT re-check the user-id allowlist in middleware
 * (that lives in `lib/auth.ts::readSession` and runs per request in
 * the Node runtime); middleware's job is to ensure the cookie signature
 * is valid and the JWT is unexpired, not to redo the allowlist.
 */

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-admin" : "admin-session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/request",
  "/api/auth/verify",
  "/api/auth/logout",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function getSecret(): Uint8Array | null {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) return null;
  return new TextEncoder().encode(s);
}

async function verifyCookie(value: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return false;
  try {
    await jwtVerify(value, secret, { audience: "admin-session" });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE);
  if (!cookie?.value) {
    if (isApi(pathname)) {
      return NextResponse.json({ error: "unauth" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // For API routes, do a full crypto verify so a forgotten readSession()
  // call in a route handler cannot leak data. UI routes still rely on
  // the server-component `requireAuth()` path.
  if (isApi(pathname)) {
    const ok = await verifyCookie(cookie.value);
    if (!ok) {
      return NextResponse.json({ error: "unauth" }, { status: 401 });
    }
  }

  // Pass the originally-requested path along so requireAuth can preserve it.
  const res = NextResponse.next();
  res.headers.set("x-admin-path", pathname);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
