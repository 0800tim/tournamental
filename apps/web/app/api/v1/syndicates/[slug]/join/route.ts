/**
 * POST /api/v1/syndicates/[slug]/join
 *
 * Adds the authenticated user to the syndicate as a member.
 * Requires an active tnm_session cookie (issued by auth-sms after
 * WhatsApp / Telegram sign-in). Anonymous joins are rejected.
 *
 * Body: { handle?: string }
 *   handle is only required if the user's session doesn't already have
 *   one set. Clients should send it whenever the join modal asks for it.
 *
 * Responses:
 *   200  { ok: true, member_count: number }
 *   400  { error: "bad_handle" | "no_session" | "bad_slug" }
 *   404  { error: "not_found" }
 *   409  { error: "already_member" }
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getPersistence } from "@/lib/syndicate/persistence";
import { notifyOwnerOfJoinRequest } from "@/lib/syndicate/notify-join-request";
import { getSessionFromRequest } from "@/lib/auth/session";
import {
  parseAllowedCountries,
  phoneMatchesAllowed,
} from "@/lib/syndicate/country-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_API = process.env.AUTH_API_URL ?? "http://localhost:3330";

const BodySchema = z.object({
  handle: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
  display_name: z.string().min(1).max(60).optional(),
});

/**
 * SEC-WEB-05: the previous version echoed any request Origin with
 * `Access-Control-Allow-Credentials: true`, which let any partner page
 * read this endpoint's responses while sending the victim's session
 * cookie. Embed widget calls use a Bearer token (not the cookie), so
 * credentials aren't needed for that case at all. We now:
 *
 *   - Allow only `*.tournamental.com` + `*.aiva.nz` + the dev hosts.
 *   - Strip `Access-Control-Allow-Credentials` for everyone (bearer
 *     auth doesn't need it, first-party cookie auth uses same-origin
 *     fetch which doesn't need CORS at all).
 *   - When the Origin isn't on the allowlist, omit
 *     `Access-Control-Allow-Origin` so the browser CORS check fails
 *     and the response is unreadable.
 */
const CORS_ALLOWED_SUFFIXES = [".tournamental.com", ".aiva.nz"];
const CORS_ALLOWED_EXACT = new Set([
  "https://tournamental.com",
  "https://aiva.nz",
  "http://localhost:3300",
  "http://localhost:3499",
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (CORS_ALLOWED_EXACT.has(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return CORS_ALLOWED_SUFFIXES.some(
      (suf) => host === suf.slice(1) || host.endsWith(suf),
    );
  } catch {
    return false;
  }
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(req: NextRequest, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

export function OPTIONS(req: NextRequest): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * Resolve the caller's identity. Two paths:
 *
 *  1. tnm_session cookie (first-party browsing on play.tournamental.com) -
 *     probed via auth-sms /v1/auth/me, which also yields the display name.
 *  2. Bearer widget-token (embedded widget on a third-party site, where the
 *     cookie is partitioned/blocked) - verified locally by
 *     getSessionFromRequest. The token carries no display name, so callers
 *     on this path must supply a handle, or one is derived below.
 */
async function resolveSession(req: NextRequest): Promise<{
  id: string;
  phone: string | null;
  displayName: string | null;
} | null> {
  const cookie = req.cookies.get("tnm_session")?.value;
  if (cookie) {
    try {
      const res = await fetch(`${AUTH_API}/v1/auth/me`, {
        headers: { Cookie: `tnm_session=${cookie}` },
      });
      if (res.ok) {
        const j = (await res.json()) as {
          user?: { id?: string; phone?: string | null; displayName?: string | null };
        };
        const u = j.user;
        if (u?.id) {
          return { id: u.id, phone: u.phone ?? null, displayName: u.displayName ?? null };
        }
      }
    } catch {
      // Fall through to the Bearer path.
    }
  }

  // Bearer widget-token (cross-origin embed). Verified against AUTH_JWT_SECRET.
  const viaJwt = await getSessionFromRequest(req);
  if (viaJwt) {
    return {
      id: viaJwt.userId,
      phone: viaJwt.phone ?? null,
      displayName: (viaJwt as { displayName?: string | null }).displayName ?? null,
    };
  }
  return null;
}

/** Derive a placeholder handle from a user id when none is supplied. */
function fallbackHandle(userId: string): string {
  const slug = userId.replace(/[^a-zA-Z0-9]/g, "");
  return `player_${slug.slice(-6) || "0000"}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json(req, { error: "bad_slug" }, 400);

  const session = await resolveSession(req);
  if (!session) return json(req, { error: "no_session" }, 401);

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json(req, { error: "not_found" }, 404);

  // Already standing in this pool? Don't manufacture a fresh "pending"
  // request. The owner (tracked authoritatively on the syndicates row)
  // and any existing active member should be reported as active so the
  // embed renders the bracket rather than "waiting for approval". This
  // matters because addMember upserts (ON CONFLICT DO UPDATE), so its
  // `inserted` flag is true even for a re-join.
  if (row.owner_user_id === session.id || persistence.isMember(row.id, session.id)) {
    return json(req, {
      ok: true,
      status: "active",
      already_member: true,
      member_count: row.member_count,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = BodySchema.safeParse(body);
  const submittedHandle = parsed.success ? parsed.data.handle : undefined;
  const submittedDisplayName = parsed.success ? parsed.data.display_name : undefined;
  const handle = submittedHandle ?? session.displayName ?? fallbackHandle(session.id);

  if (!handle || handle.length < 2) {
    return json(req, { error: "bad_handle", message: "A handle is required to join." }, 400);
  }

  // Country gate. If the pool restricts entries by phone-country
  // (allowed_phone_countries CSV is non-empty), reject joiners whose
  // verified phone does NOT carry one of the allowed dial codes.
  // Owners are exempt: a Sydney-HQ brand can administer a NZ-only pool
  // from their +61 number. Spec: docs/68-country-gated-pools.md.
  const allowed = parseAllowedCountries(row.allowed_phone_countries);
  if (allowed.length > 0) {
    const isOwnerForExemption = row.owner_user_id === session.id;
    if (!isOwnerForExemption && !phoneMatchesAllowed(session.phone, allowed)) {
      // 403 with structured payload so the JoinFlowClient can route
      // straight to the friendly CountryRestrictedScreen + upsell.
      // We surface the allow-list so the screen can render the right
      // flags without re-fetching the pool.
      return json(
        req,
        {
          ok: false,
          reason: "country_restricted",
          allowed_countries: allowed,
          // The directory page accepts ?eligible_for=<dial> to filter
          // to pools the visitor CAN join. If the visitor has no
          // verified phone yet (edge case), omit the filter so the
          // directory shows everything.
          directory_url: session.phone
            ? `/pools?eligible_for=${encodeURIComponent(session.phone)}`
            : `/pools`,
        },
        403,
      );
    }
  }

  // Handle collision check (per-pool). Skip if the user is rejoining
  // with the SAME handle they already hold in this pool.
  if (
    submittedHandle &&
    persistence.isHandleTakenInSyndicate(row.id, submittedHandle)
  ) {
    const claimedBySomeoneElse = persistence
      .getMembers(row.id)
      .some(
        (m) =>
          !!m.handle &&
          m.handle.toLowerCase() === submittedHandle.toLowerCase() &&
          m.user_id !== session.id,
      );
    if (claimedBySomeoneElse) {
      return json(req, 
        {
          error: "handle_taken",
          message: `Sorry, "${submittedHandle}" is already taken in this pool. Pick a different handle.`,
        },
        409,
      );
    }
  }

  // Approval-gated pools: insert membership row with status='pending'
  // so the user shows up in the owner's approval queue. The pool's
  // public surfaces (landing, member_count) ignore pending rows so the
  // requester doesn't appear in any leaderboard or grid until the
  // owner approves (Tim 2026-05-22).
  const requiresApproval = !!(row as unknown as { requires_approval?: number })
    .requires_approval;

  // Insert (or upsert) member row via the persistence API. The new
  // `addMember` helper carries handle + display_name through and
  // returns whether a fresh row was inserted vs an existing row
  // upserted.
  let inserted = false;
  try {
    const r = persistence.addMember({
      syndicate_id: row.id,
      user_id: session.id,
      role: "member",
      handle,
      display_name: submittedDisplayName ?? session.displayName ?? null,
      status: requiresApproval ? "pending" : "active",
    });
    inserted = r.inserted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      return json(req, { error: "already_member" }, 409);
    }
    throw err;
  }

  if (!inserted) {
    // Already a member (owner re-join or repeat join). Handle /
    // display_name still update via the UPSERT in addMember, so the
    // caller's chosen handle wins for future leaderboards.
    return json(req, {
      ok: true,
      already_member: true,
      member_count: row.member_count,
    });
  }

  if (requiresApproval) {
    // Fire the owner notification best-effort so a SendGrid hiccup
    // doesn't fail the join request itself. The owner can still find
    // the request in their dashboard if the email never lands.
    void notifyOwnerOfJoinRequest({
      pool: row,
      requester: {
        user_id: session.id,
        handle,
        display_name: submittedDisplayName ?? session.displayName ?? null,
      },
    }).catch(() => undefined);
    return json(req, { ok: true, status: "pending" });
  }

  // Bump the cached member_count on the syndicates row. The game
  // service owns the authoritative count; this is an optimistic update
  // so the landing page reflects the new join immediately.
  try {
    (persistence as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } })
      .db
      .prepare(`UPDATE syndicates SET member_count = member_count + 1 WHERE id = ?`)
      .run(row.id);
  } catch {
    // Non-fatal - member_count is eventually consistent via game service.
  }

  return json(req, { ok: true, status: "active", member_count: row.member_count + 1 });
}

/**
 * GET - membership status for the authed viewer. Returns
 * `{ is_member }` (false when there's no session, no pool, or the user
 * isn't a member). Used by the share page CTA to show Join vs Exit.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json(req, { is_member: false });
  const session = await resolveSession(req);
  if (!session) return json(req, { is_member: false, status: "none" });
  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json(req, { is_member: false, status: "none" });
  const isOwner = row.owner_user_id === session.id;
  // `status` lets the embed decide what to show on load without mutating
  // anything: owner/active -> bracket, pending -> waiting screen, denied
  // -> declined, none -> request-access CTA.
  const status = isOwner ? "owner" : persistence.getMembershipStatus(row.id, session.id);
  return json(req, {
    is_member: isOwner || persistence.isMember(row.id, session.id),
    is_owner: isOwner,
    status,
  });
}

/**
 * DELETE - the authed user leaves the pool. Owners can't leave their own
 * pool (protected in removeMember). Decrements the cached member_count.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug) return json(req, { error: "bad_slug" }, 400);
  const session = await resolveSession(req);
  if (!session) return json(req, { error: "no_session" }, 401);
  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json(req, { error: "not_found" }, 404);

  const { removed } = persistence.removeMember(row.id, session.id);
  if (removed) {
    try {
      (persistence as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } })
        .db
        .prepare(`UPDATE syndicates SET member_count = MAX(0, member_count - 1) WHERE id = ?`)
        .run(row.id);
    } catch {
      // Non-fatal - member_count is eventually consistent via game service.
    }
  }
  return json(req, { ok: true, left: removed });
}
