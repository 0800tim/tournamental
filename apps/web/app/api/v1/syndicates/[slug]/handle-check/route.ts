/**
 * GET /api/v1/syndicates/[slug]/handle-check?handle=<h>
 *
 * Pre-OTP availability probe for the JoinSyndicate modal. Returns
 * `{ available: boolean }` so the modal can block submit + show
 * "Sorry, that handle is already taken" without spending a fresh
 * WhatsApp OTP attempt.
 *
 * Public endpoint (no auth required) — the membership table doesn't
 * leak any private info via a yes/no probe; the handle itself is
 * already visible on the public share-landing leaderboard.
 *
 * Responses:
 *   200 { ok: true, available: true|false }
 *   400 { error: "bad_handle" | "bad_slug" }
 *   404 { error: "not_found" }
 */

import type { NextRequest } from "next/server";
import { getPersistence } from "@/lib/syndicate/persistence";
import { getSessionFromRequest } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/rate-limit/in-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HANDLE_RE = /^[a-zA-Z0-9_]{2,32}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) {
    return json({ error: "bad_slug" }, 400);
  }

  // SEC-POOL-09: per-IP rate limit (30/min) so this can't be used as
  // a name-enumeration channel against a popular pool.
  const ip = clientIp(req);
  const rl = checkRateLimit(`handle-check:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return json(
      { error: "rate_limited", retry_after_seconds: Math.ceil(rl.retryAfterMs / 1000) },
      429,
    );
  }

  const url = new URL(req.url);
  const handle = (url.searchParams.get("handle") ?? "").trim();
  if (!handle || !HANDLE_RE.test(handle)) {
    return json({ error: "bad_handle" }, 400);
  }

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json({ error: "not_found" }, 404);

  // Tim 2026-06-04: the prior "private pools require auth" gate
  // (originally added under SEC-POOL-09 as defence-in-depth) broke
  // the join flow for private pools — an anon visitor following a
  // share link could never validate a handle before submitting, so
  // every handle came back looking "taken". The 30/min per-IP rate
  // limit above is the enumeration defence; the handles themselves
  // already appear on the in-pool leaderboard, so a yes/no probe
  // doesn't leak anything a member couldn't already see.
  void getSessionFromRequest;

  const taken = persistence.isHandleTakenInSyndicate(row.id, handle);
  return json({ ok: true, available: !taken });
}
