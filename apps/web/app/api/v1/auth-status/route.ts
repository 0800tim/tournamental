/**
 * GET /api/v1/auth-status — CORS-open auth probe for the embed widget.
 *
 * Returns only `{ authenticated: boolean }`. No PII. Used by the
 * widget on partner sites to decide whether to show the bracket
 * iframe or the "Log in to play" CTA.
 *
 * CORS: echoes the request Origin and allows credentials. The browser
 * needs both for credentialed cross-origin requests; wildcard `*`
 * isn't valid with credentials. Echoing Origin is safe here because
 * we don't expose any data the partner site couldn't infer by
 * watching the iframe content (which it could already screenshot).
 */

import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: NextRequest): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Max-Age": "600",
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  return new Response(
    JSON.stringify({ authenticated: !!session }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        ...corsHeaders(req),
      },
    },
  );
}
