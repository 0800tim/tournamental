/**
 * /api/odds/country
 *
 * Tiny endpoint that returns the visitor's Cloudflare-derived country
 * code (or a header alias). The bracket page is fully static, so we
 * resolve the country client-side; this endpoint is the single source
 * of truth.
 *
 * Cache: per-request (no edge caching), but very small payload.
 */

import { NextResponse, type NextRequest } from "next/server";

import { readCountryFromHeaders } from "@/lib/odds/geo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const country = readCountryFromHeaders(req.headers);
  return NextResponse.json(
    { country },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
