/**
 * POST /api/auth/verify — verify the WhatsApp OTP, mint admin session.
 *
 * Body: { code: "123456" }
 *
 * Flow:
 *   1. Forwards `{ phone: ADMIN_PHONE_E164, code }` to `apps/auth-sms`
 *      `/v1/auth/verify` (the phone-scoped endpoint). Pinning the phone
 *      server-side means the verify call only consumes the admin's own
 *      OTP budget, so a concurrent OTP-holder for a different phone
 *      cannot exhaust the admin's 5-attempt budget through this route.
 *   2. On 200, the upstream returns `{ jwt, expiresAt, user }`.
 *   3. We check `user.id` against `ADMIN_ALLOWED_USER_IDS`. Mismatch →
 *      403 `not_admin`, no cookie set. (The verified user is a real
 *      Tournamental user — just not one we trust with admin.)
 *   4. Mint our own `admin_session` JWT (24h, separate secret) and set
 *      it as the `__Host-admin` / `admin-session` cookie.
 *
 * The auth-sms `Set-Cookie` (`tnm_session`) is intentionally NOT
 * propagated to the browser: admin is a separate authority domain and
 * we don't want signing into admin to silently sign the same browser
 * into `play.tournamental.com` too.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  getAdminPhone,
  getAllowedUserIds,
  getAuthSmsBase,
  isLoginEnabled,
  issueSessionCookie,
  maskAdminPhone,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyOk {
  jwt?: string;
  ok?: boolean;
  expiresAt?: number;
  user: { id: string; phone: string | null; displayName: string | null };
}

const RATE: Map<string, number[]> = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = RATE.get(key)?.filter((t) => now - t < WINDOW_MS) ?? [];
  if (arr.length >= MAX_PER_WINDOW) return true;
  arr.push(now);
  RATE.set(key, arr);
  return false;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  if (!isLoginEnabled()) {
    return NextResponse.json({ error: "login_disabled" }, { status: 503 });
  }
  if (rateLimited(`ip:${clientIp(req)}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "bad_code" }, { status: 400 });
  }

  // Pin the verify call to the configured admin phone. This scopes the
  // OTP brute-force budget on auth-sms to the admin's own phone row,
  // not the global "most recent unconsumed OTP" used by /verify-by-code.
  const phone = getAdminPhone();
  if (!phone) {
    return NextResponse.json({ error: "login_disabled" }, { status: 503 });
  }

  const url = `${getAuthSmsBase()}/v1/auth/verify`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (upstream.status === 401) {
    return NextResponse.json({ error: "bad_code" }, { status: 401 });
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "upstream_error", status: upstream.status },
      { status: upstream.status === 429 ? 429 : 502 },
    );
  }

  let data: VerifyOk;
  try {
    data = (await upstream.json()) as VerifyOk;
  } catch {
    return NextResponse.json({ error: "upstream_bad_body" }, { status: 502 });
  }
  if (!data?.user?.id) {
    return NextResponse.json({ error: "upstream_bad_body" }, { status: 502 });
  }

  // Hard allowlist check. A leaked OTP that resolves to a non-admin user
  // is still rejected here — admin status isn't a function of having a
  // valid OTP, it's a function of being on this list.
  const allowed = getAllowedUserIds();
  if (!allowed.has(data.user.id)) {
    return NextResponse.json({ error: "not_admin" }, { status: 403 });
  }

  const displayLabel = data.user.phone
    ? maskAdminPhone(data.user.phone)
    : (data.user.displayName ?? data.user.id);

  const cookie = await issueSessionCookie({
    userId: data.user.id,
    displayLabel,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: cookie.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    // `__Host-` cookies in production forbid the Domain attribute and
    // require Path=/. `cookies.set` here omits Domain by default.
  });
  return res;
}
