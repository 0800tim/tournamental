import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await readSession();
  if (session) {
    await writeAudit(session, { action: "auth.logout", target: session.email });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
