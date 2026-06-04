/**
 * Admin endpoints for the WhatsApp channel availability flag.
 *
 * GET   /api/admin/channels/whatsapp   read current channel state
 * POST  /api/admin/channels/whatsapp   flip enabled with a free-form reason
 *
 * Both require the admin session cookie (via requireAuth). The POST
 * proxies through to auth-sms's /v1/auth/admin/channels/whatsapp with
 * the AUTH_ADMIN_TOKEN header so the operator never sees the auth-sms
 * admin secret. State is short-cached at the auth-sms edge (10s); the
 * SignupModal picks up the flip within ~10 seconds on every open.
 *
 * Tim 2026-06-04, ahead of the TV publicity spike.
 */

import { NextResponse, type NextRequest } from "next/server";

import { requireAuth, getAuthSmsBase } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authSmsAdminToken(): string | null {
  return process.env.AUTH_ADMIN_TOKEN ?? null;
}

export async function GET() {
  await requireAuth();
  try {
    const r = await fetch(`${getAuthSmsBase()}/v1/auth/channels`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!r.ok) {
      return NextResponse.json({ error: "upstream_error" }, { status: 502 });
    }
    const body = await r.json();
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "upstream_unreachable" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  await requireAuth();
  const token = authSmsAdminToken();
  if (!token) {
    return NextResponse.json(
      { error: "auth_sms_admin_token_not_configured" },
      { status: 503 },
    );
  }
  let body: { enabled?: boolean; reason?: string };
  try {
    body = (await req.json()) as { enabled?: boolean; reason?: string };
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled_required" }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim() || "no reason given";
  try {
    const r = await fetch(
      `${getAuthSmsBase()}/v1/auth/admin/channels/whatsapp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": token,
        },
        body: JSON.stringify({ enabled: body.enabled, reason }),
        cache: "no-store",
      },
    );
    const payload = await r.json().catch(() => ({}));
    return NextResponse.json(payload, { status: r.status });
  } catch {
    return NextResponse.json(
      { error: "upstream_unreachable" },
      { status: 502 },
    );
  }
}
