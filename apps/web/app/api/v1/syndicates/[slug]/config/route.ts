/**
 * GET /api/v1/syndicates/[slug]/config
 *
 * Public, no-auth, CORS-open endpoint that the embed widget calls
 * from any partner site to fetch a syndicate's branding + public
 * stats. This is the integration surface for
 * `<tournamental-syndicate slug="...">` on third-party sites.
 *
 * Returned fields are the minimum the widget needs to render itself:
 * brand colours, logos, hero, prize copy, member count, sponsor block,
 * and the public landing URL. Owner contact details and HL identifiers
 * are deliberately NOT in this projection.
 *
 * CORS: `Access-Control-Allow-Origin: *` so the widget works from
 * any partner domain. No credentials are read; no cookies are set.
 *
 * Cache: 5 minutes at the edge with SWR for a day. Branding changes
 * propagate within 5 minutes; aggressive caching keeps the widget
 * fast on busy partner sites.
 */

import type { NextRequest } from "next/server";

import { getPersistence } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
};

function jsonResponse(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      ...(extraHeaders ?? {}),
    },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").toLowerCase().trim();
  if (!slug || !/^[a-z0-9-]{1,64}$/.test(slug)) {
    return jsonResponse({ error: "bad_slug" }, 400, { "Cache-Control": "no-store" });
  }

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) {
    return jsonResponse({ error: "not_found" }, 404, { "Cache-Control": "no-store" });
  }

  // Premium tier syndicates may remove the Tournamental footer from
  // their embed; surface the flag so the widget knows whether to
  // hide it. Free tier always shows the footer.
  const hideFooter = row.tier === "premium";

  // Public landing URL for the "open in Tournamental" link inside the
  // widget. The /s/<...> resolver matches slug-shape inputs in step 1
  // and bracket-guid-shape inputs in step 2; using the slug here lands
  // on the syndicate page reliably (a 16-char hex share_guid would
  // false-match the nanoid bracket-guid pattern and 404 in step 2).
  const publicLandingUrl = `https://play.tournamental.com/s/${row.slug}`;
  const joinUrl = `https://play.tournamental.com/s/${row.slug}?join=1`;

  // Decode the prize split (stored as JSON string). Surface as null if
  // malformed rather than 500-ing — the widget falls back to prize_text.
  let prizeSplit: unknown = null;
  if (row.prize_split_json) {
    try {
      prizeSplit = JSON.parse(row.prize_split_json);
    } catch {
      prizeSplit = null;
    }
  }

  return jsonResponse(
    {
      ok: true,
      syndicate: {
        slug: row.slug,
        name: row.name,
        tournament_id: row.tournament_id,
        tier: row.tier,
        member_count: row.member_count,
        branding: {
          primary_colour: row.branding_primary_colour ?? "#fbbf24",
          accent_colour: row.branding_accent_colour ?? "#21a34a",
          logo_url: row.branding_logo_url,
          hero_url: row.branding_hero_url,
        },
        sponsor:
          row.sponsor_name || row.sponsor_logo_url
            ? {
                name: row.sponsor_name,
                url: row.sponsor_url,
                logo_url: row.sponsor_logo_url,
              }
            : null,
        prize_text: row.prize_text,
        entry_fee:
          row.entry_fee_cents !== null && row.entry_fee_cents > 0
            ? {
                cents: row.entry_fee_cents,
                currency: row.entry_fee_currency ?? "NZD",
              }
            : null,
        prize_split: prizeSplit,
        bonus_prize_text: row.bonus_prize_text,
        public_landing_url: publicLandingUrl,
        join_url: joinUrl,
        hide_tournamental_footer: hideFooter,
      },
    },
    200,
    CACHE_HEADERS,
  );
}
