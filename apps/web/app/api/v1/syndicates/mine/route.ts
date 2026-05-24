/**
 * GET /api/v1/syndicates/mine
 *
 * Returns the list of syndicates owned by the currently-authenticated
 * user. Powers the My-pools section on /profile and the affiliate
 * dashboard at /dashboard/syndicates.
 *
 * Auth: requires a valid `tnm_session` cookie. 401 if absent or
 * invalid. Never reveals whether a given user has zero syndicates vs
 * is unauthenticated -- those are different status codes for the
 * dashboard to render different UI.
 *
 * Ownership resolution (Tim 2026-05-24): in addition to the canonical
 * owner_user_id column match, the route reconciles two legacy paths
 * for pools created before the create-route learned to bind
 * owner_user_id from the session:
 *
 *   - email match against the user's auth-sms-verified email when
 *     owner_user_id is null
 *   - handle slug match against the membership table's `handle`
 *     column when user_id is the `anon:<id>` placeholder
 *
 * Both hints are sourced from /v1/auth/me (cookie-forwarded) so they
 * are verified, not free-text claims.
 *
 * Cache policy: `private, no-store`. Per-user content, never cached.
 */

import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { getPersistence } from "@/lib/syndicate/persistence";
import { slugifyDisplayName } from "@/lib/share/handle-slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * Forward the inbound cookie to auth-sms /v1/auth/me and pluck the
 * fields the legacy-pool reconciliation needs. Best-effort: a network
 * failure or missing fields returns nulls; the listing then falls
 * back to the userId-only match path.
 */
async function lookupOwnerHints(req: NextRequest): Promise<{
  emailLower: string | null;
  handleSlug: string | null;
}> {
  const base = (
    process.env.AUTH_API_BASE ??
    process.env.AUTH_API_URL ??
    process.env.NEXT_PUBLIC_AUTH_BASE_URL ??
    process.env.NEXT_PUBLIC_AUTH_API_URL ??
    "http://localhost:3330"
  ).replace(/\/+$/, "");
  if (!base) return { emailLower: null, handleSlug: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 500);
  try {
    const cookie = req.headers.get("cookie") ?? "";
    const res = await fetch(`${base}/v1/auth/me`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", cookie },
    });
    clearTimeout(timer);
    if (!res.ok) return { emailLower: null, handleSlug: null };
    const body = (await res.json()) as {
      user?: { displayName?: string | null; email?: string | null };
    };
    const email = body?.user?.email ?? null;
    return {
      emailLower: email ? email.toLowerCase() : null,
      handleSlug: slugifyDisplayName(body?.user?.displayName ?? null),
    };
  } catch {
    clearTimeout(timer);
    return { emailLower: null, handleSlug: null };
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return jsonResponse({ error: "unauthorised" }, 401);
  }

  const hints = await lookupOwnerHints(req);
  const persistence = getPersistence();
  const rows = persistence.listOwnedByUserIdOrLegacyHints(session.userId, hints);

  // Trim the rows to the fields the dashboard actually needs. Owner
  // contact details, the GHL retry-queue, etc. don't belong in this
  // response shape, which is consumed by the owner's own browser.
  const syndicates = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    tournament_id: r.tournament_id,
    tier: r.tier,
    member_count: r.member_count,
    created_at: r.created_at,
    share_guid: r.share_guid,
    hl_location_id: r.hl_location_id,
    hl_premium_since: r.hl_premium_since,
    topic: r.topic,
  }));

  return jsonResponse(
    {
      ok: true,
      count: syndicates.length,
      syndicates,
    },
    200,
  );
}
