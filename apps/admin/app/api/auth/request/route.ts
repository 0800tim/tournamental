/**
 * POST /api/auth/request — kick off an OTP for the admin gate.
 *
 * Body: { channel?: "whatsapp" | "sms" | "email" }. Defaults to
 * "whatsapp" for back-compat. The recipient (phone or email) is
 * hardcoded server-side via `ADMIN_PHONE_E164` and `ADMIN_EMAIL`
 * respectively, so an attacker who clears Cloudflare Access still
 * cannot direct OTPs to a destination they control.
 *
 * Routing:
 *   - whatsapp | sms → auth-sms `POST /v1/auth/request` with
 *     `{ phone: ADMIN_PHONE_E164, channel }`.
 *   - email          → auth-sms `POST /v1/auth/email/request` with
 *     `{ email: ADMIN_EMAIL }`. This path bypasses aiva-api/Baileys
 *     entirely (it sends via SendGrid) so it survives a WhatsApp
 *     outage or a carrier SMS outage; it is the lock-out escape
 *     hatch when both phone-side transports are degraded.
 *
 * The browser only ever sees an opaque `{ ok, channel }` response.
 * No confirmation of the underlying number or address is leaked.
 *
 * Rate limiting: auth-sms already enforces per-recipient cooldown +
 * hourly cap; we add a per-IP burst guard so a buggy auto-submitter
 * cannot waste OTP budget.
 *
 * Tim 2026-06-12: added SMS + email fallback after a Meta WhatsApp
 * suspension locked out admin login.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminEmail,
  getAdminPhone,
  getAuthSmsBase,
  isLoginEnabled,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Channel = "whatsapp" | "sms" | "email";

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

function parseChannel(raw: unknown): Channel {
  if (raw === "sms" || raw === "email" || raw === "whatsapp") return raw;
  return "whatsapp";
}

export async function POST(req: NextRequest) {
  if (!isLoginEnabled()) {
    return NextResponse.json({ error: "login_disabled" }, { status: 503 });
  }
  if (rateLimited(`ip:${clientIp(req)}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { channel?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    /* empty body is fine, defaults apply */
  }
  const channel: Channel = parseChannel(body.channel);

  // Email branch goes through the dedicated email-OTP route, which is
  // SendGrid-backed and independent of the phone transports.
  if (channel === "email") {
    const email = getAdminEmail();
    if (!email) {
      return NextResponse.json(
        { error: "email_not_configured" },
        { status: 503 },
      );
    }
    const url = `${getAuthSmsBase()}/v1/auth/email/request`;
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        cache: "no-store",
      });
    } catch {
      return NextResponse.json(
        { error: "upstream_unreachable" },
        { status: 502 },
      );
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "upstream_error", status: upstream.status },
        { status: upstream.status === 429 ? 429 : 502 },
      );
    }
    return NextResponse.json({ ok: true, channel: "email" });
  }

  // Phone branch (whatsapp + sms): same endpoint, different transport.
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
      body: JSON.stringify({ phone, channel }),
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

  return NextResponse.json({ ok: true, channel });
}
