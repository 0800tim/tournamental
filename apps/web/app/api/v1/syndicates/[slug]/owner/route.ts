/**
 * /api/v1/syndicates/[slug]/owner
 *
 * Owner-scoped read + write for a single syndicate.
 *
 *   GET    — return the full row (401/403/404 as appropriate)
 *   PATCH  — apply a branding/sponsor/prize patch
 *
 * Both methods require a valid tnm_session cookie AND ownership of
 * the syndicate. Powers `/dashboard/syndicates/[slug]`. The public
 * embed widget uses a different endpoint
 * (`/api/v1/syndicates/[slug]/config`) with no auth.
 *
 * Cache: private, no-store. Per-user, mutable.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { getSessionFromRequest } from "@/lib/auth/session";
import {
  getPersistence,
  type SyndicateBrandingPatch,
  type SyndicateRow,
} from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function projectOwnerRow(row: SyndicateRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tournament_id: row.tournament_id,
    tier: row.tier,
    member_count: row.member_count,
    created_at: row.created_at,
    share_guid: row.share_guid,
    hl_location_id: row.hl_location_id,
    hl_premium_since: row.hl_premium_since,
    topic: row.topic,
    size_band: row.size_band,
    marketing_consent: row.marketing_consent === 1,
    owner_handle: row.owner_handle,
    branding_primary_colour: row.branding_primary_colour,
    branding_accent_colour: row.branding_accent_colour,
    branding_logo_url: row.branding_logo_url,
    branding_hero_url: row.branding_hero_url,
    sponsor_name: row.sponsor_name,
    sponsor_url: row.sponsor_url,
    sponsor_logo_url: row.sponsor_logo_url,
    prize_text: row.prize_text,
  };
}

async function authoriseOwner(
  req: NextRequest,
  slug: string,
): Promise<
  | { ok: true; row: SyndicateRow; userId: string }
  | { ok: false; response: Response }
> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: jsonResponse({ error: "unauthorised" }, 401) };
  }
  if (!slug) {
    return { ok: false, response: jsonResponse({ error: "bad_slug" }, 400) };
  }
  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) {
    return { ok: false, response: jsonResponse({ error: "not_found" }, 404) };
  }
  if (row.owner_user_id !== session.userId) {
    return { ok: false, response: jsonResponse({ error: "forbidden" }, 403) };
  }
  return { ok: true, row, userId: session.userId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const auth = await authoriseOwner(req, (params.slug ?? "").toLowerCase().trim());
  if (!auth.ok) return auth.response;
  return jsonResponse({ ok: true, syndicate: projectOwnerRow(auth.row) }, 200);
}

// --- PATCH ------------------------------------------------------------------

// Hex colour `#rrggbb` or `#rgb`. Optional `null` to clear.
const HexColour = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "must be a hex colour like #fbbf24")
  .nullable();

const HttpsUrl = z
  .string()
  .url("must be a valid URL")
  .refine((u) => /^https?:\/\//i.test(u), "must start with http(s)")
  .nullable();

const PatchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    branding_primary_colour: HexColour.optional(),
    branding_accent_colour: HexColour.optional(),
    branding_logo_url: HttpsUrl.optional(),
    branding_hero_url: HttpsUrl.optional(),
    sponsor_name: z.string().max(120).nullable().optional(),
    sponsor_url: HttpsUrl.optional(),
    sponsor_logo_url: HttpsUrl.optional(),
    prize_text: z.string().max(280).nullable().optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  const auth = await authoriseOwner(req, slug);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: "invalid_body",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    );
  }

  // Drop any field that is undefined. Zod converts missing keys to
  // undefined; the persistence layer treats undefined as "leave alone".
  const patch: SyndicateBrandingPatch = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) {
      (patch as Record<string, unknown>)[k] = v;
    }
  }

  const persistence = getPersistence();
  const updated = persistence.updateBranding(slug, patch);
  if (!updated) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  return jsonResponse({ ok: true, syndicate: projectOwnerRow(updated) }, 200);
}
