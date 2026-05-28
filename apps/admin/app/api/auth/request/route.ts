/**
 * POST /api/auth/request — kick off a WhatsApp OTP for the admin gate.
 *
 * Body: (none). The phone is hardcoded server-side via `ADMIN_PHONE_E164`
 * so an attacker who clears Cloudflare Access still can't direct OTPs
 * to a number they control.
 *
 * Forwards to `apps/auth-sms` `/v1/auth/request` with
 * `{ phone, channel: "whatsapp" }`. The browser only ever sees an
 * opaque `{ ok }` response — no confirmation of which number was used.
 *
 * Rate limiting: auth-sms already enforces per-phone cooldown +
 * hourly cap; we add a per-IP burst guard so a buggy form auto-submitter
 * can't waste OTP budget.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getAdminPhone, getAuthSmsBase, isLoginEnabled } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE: Map<string, number[]> = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

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

  const phone = getAdminPhone();
  if (!phone) {
    return NextResponse.json({ error: "login_disabled" }, { status: 503 });
  }

  const url = `${getAuthSmsBase()}/v1/auth/request`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, channel: "whatsapp" }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "upstream_error", status: upstream.status },
      { status: upstream.status === 429 ? 429 : 502 },
    );
  }

  return NextResponse.json({ ok: true, channel: "whatsapp" });
}
