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
import { invalidateSyndicateOgCache } from "@/lib/og/syndicate-cache";

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
    entry_fee_cents: row.entry_fee_cents,
    entry_fee_currency: row.entry_fee_currency,
    prize_split_json: row.prize_split_json,
    bonus_prize_text: row.bonus_prize_text,
    join_fee_terms_text: row.join_fee_terms_text,
    is_public: row.is_public === 1,
    requires_approval: row.requires_approval === 1,
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
  // Surface pending join requests so the dashboard manage view can
  // render an approval queue alongside the standard owner row.
  // Tokenised approve/deny links are sent via email separately
  // (notify-join-request.ts); this list is the in-app fallback for
  // when the email isn't delivered or the owner prefers the
  // dashboard (Tim 2026-05-22).
  let pending_requests: ReturnType<
    ReturnType<typeof getPersistence>["listPendingMembers"]
  > = [];
  try {
    pending_requests = getPersistence().listPendingMembers(auth.row.id);
  } catch {
    /* schema not ready in this environment */
  }
  return jsonResponse(
    {
      ok: true,
      syndicate: projectOwnerRow(auth.row),
      pending_requests,
    },
    200,
  );
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

const PrizeSplitEntry = z.object({
  rank: z.number().int().min(1).max(20),
  percent: z.number().min(0).max(100),
  label: z.string().max(120).nullable().optional(),
  sponsor_name: z.string().max(120).nullable().optional(),
});

const PatchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    /** Pool intro / description shown under the title on /s/<slug>. */
    topic: z.string().max(600).nullable().optional(),
    branding_primary_colour: HexColour.optional(),
    branding_accent_colour: HexColour.optional(),
    branding_logo_url: HttpsUrl.optional(),
    branding_hero_url: HttpsUrl.optional(),
    sponsor_name: z.string().max(120).nullable().optional(),
    sponsor_url: HttpsUrl.optional(),
    sponsor_logo_url: HttpsUrl.optional(),
    prize_text: z.string().max(600).nullable().optional(),
    /** Cents. 0 or null means "no fee". */
    entry_fee_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    entry_fee_currency: z.string().length(3).nullable().optional(),
    /**
     * Prize-split entries, validated to sum to 100% before save.
     * Pass `null` to clear (e.g. revert to a single-prize string).
     */
    prize_split: z.array(PrizeSplitEntry).max(20).nullable().optional(),
    bonus_prize_text: z.string().max(280).nullable().optional(),
    /** Admin-authored terms + payment instructions for paid pools, shown
     * on the join flow. Tournamental never handles the money. */
    join_fee_terms_text: z.string().max(2000).nullable().optional(),
    /** Visibility toggles. The persistence layer enforces public-and-
     * requires-approval are mutually exclusive; sending both is fine,
     * is_public wins. */
    is_public: z.boolean().optional(),
    requires_approval: z.boolean().optional(),
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

  // Map the API surface to the persistence patch. prize_split arrives
  // as a structured array; we serialise to JSON for storage. Validate
  // the percentage sum here (Zod doesn't easily express the cross-field
  // constraint).
  const patch: SyndicateBrandingPatch = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    if (k === "prize_split") {
      if (v === null) {
        patch.prize_split_json = null;
      } else {
        const arr = v as Array<{ rank: number; percent: number }>;
        const total = arr.reduce((acc, e) => acc + e.percent, 0);
        if (Math.round(total) !== 100) {
          return jsonResponse(
            { error: "prize_split_must_sum_to_100", actual: total },
            400,
          );
        }
        patch.prize_split_json = JSON.stringify(arr);
      }
      continue;
    }
    (patch as Record<string, unknown>)[k] = v;
  }

  const persistence = getPersistence();
  const updated = persistence.updateBranding(slug, patch);
  if (!updated) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  // Branding fields drive the OG render -- pop the cache so the next
  // share-crawler hit re-renders against the patched row.
  void invalidateSyndicateOgCache(slug);

  return jsonResponse({ ok: true, syndicate: projectOwnerRow(updated) }, 200);
}
