/**
 * GET /api/v1/admin/hl-status
 *
 * Returns whether the HighLevel integration env vars are configured.
 * Visible only to platform admins (user ids listed in the
 * TNM_ADMIN_USER_IDS env var). The banner that consumes this endpoint
 * is hidden from regular syndicate hosts, who shouldn't see operator
 * concerns.
 *
 * Response (200, admin):
 *   {
 *     ok: true,
 *     hl_webhook_secret_set: boolean,
 *     hl_checkout_url_set: boolean,
 *     hl_agency_api_key_set: boolean,
 *     hl_main_location_id_set: boolean,
 *     all_configured: boolean
 *   }
 *
 * Response (200, not-admin or not-signed-in):
 *   { ok: true, admin: false }
 *
 * Never leaks the env var values themselves — only their presence.
 */

import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function isAdmin(userId: string): boolean {
  const list = process.env.TNM_ADMIN_USER_IDS ?? "";
  if (!list) return false;
  const ids = list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.includes(userId);
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session || !isAdmin(session.userId)) {
    // Non-admin response: just say "you're not an admin". We don't
    // reveal whether HL is wired up to non-admins.
    return jsonResponse({ ok: true, admin: false }, 200);
  }

  const secret = process.env.HL_WEBHOOK_SECRET ?? "";
  const checkout = process.env.NEXT_PUBLIC_HL_CHECKOUT_URL ?? "";
  const agencyKey = process.env.HL_AGENCY_API_KEY ?? "";
  const mainLocationId = process.env.HL_MAIN_LOCATION_ID ?? "";

  const hl_webhook_secret_set = secret.length >= 16;
  const hl_checkout_url_set =
    checkout.length > 0 &&
    !checkout.includes("tournamental.com/syndicates#pricing");
  const hl_agency_api_key_set = agencyKey.length >= 16;
  const hl_main_location_id_set = mainLocationId.length > 0;

  return jsonResponse(
    {
      ok: true,
      admin: true,
      hl_webhook_secret_set,
      hl_checkout_url_set,
      hl_agency_api_key_set,
      hl_main_location_id_set,
      all_configured:
        hl_webhook_secret_set &&
        hl_checkout_url_set &&
        hl_agency_api_key_set &&
        hl_main_location_id_set,
    },
    200,
  );
}
