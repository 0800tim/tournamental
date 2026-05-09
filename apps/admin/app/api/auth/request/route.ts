import { NextResponse, type NextRequest } from "next/server";
import { createMagicLink, isLoginEnabled } from "@/lib/auth";
import { sendMagicLink } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory throttle. Per-IP, 5 requests / 60 seconds. Light defence;
// the real rate limiter is at the Cloudflare edge, but we still want a
// bound on accidental spam from a buggy form auto-submitter.
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

export async function POST(req: NextRequest) {
  // Defence-in-depth: shut the door if the dashboard is locked.
  if (!isLoginEnabled()) {
    return NextResponse.json({ error: "login_disabled" }, { status: 503 });
  }

  const ip = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  if (rateLimited(`ip:${ip}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { email?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }

  // Always pretend success to defeat enumeration. createMagicLink returns
  // null when the email isn't on the allowlist; we still respond 200.
  const link = await createMagicLink(email);
  if (link) {
    const r = await sendMagicLink({ to: email, url: link.url, expiresAt: link.expiresAt });
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error("[admin/auth] mailer error:", r.error);
    }
  }

  return NextResponse.json({ ok: true });
}
