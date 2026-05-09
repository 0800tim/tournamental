import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  issueSessionCookie,
  verifyMagicLink,
} from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "invalid");
    url.search = url.searchParams.toString();
    return NextResponse.redirect(url);
  }

  const session = await verifyMagicLink(token);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "expired");
    return NextResponse.redirect(url);
  }

  const jwt = await issueSessionCookie(session);
  const url = req.nextUrl.clone();
  url.pathname = req.nextUrl.searchParams.get("next") || "/";
  url.search = "";

  const res = NextResponse.redirect(url);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: jwt,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  await writeAudit(session, { action: "auth.login", target: session.email });
  return res;
}
