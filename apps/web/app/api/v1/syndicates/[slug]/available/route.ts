/**
 * GET /api/v1/syndicates/:slug/available
 *
 * Live availability check used by the signup form's slug field.
 * Debounced 300ms client-side; this handler responds in <50ms by
 * going straight to the in-process SQLite store.
 *
 * Response shape:
 *   { available: boolean, reason: "ok" | "reserved" | "taken" | "invalid" }
 */

import type { NextRequest } from "next/server";

import { getPersistence } from "@/lib/syndicate/persistence";
import { validateSlug } from "@/lib/syndicate/slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Reason = "ok" | "reserved" | "taken" | "invalid";

function jsonResponse(
  available: boolean,
  reason: Reason,
  status = 200,
): Response {
  return Response.json(
    { available, reason },
    {
      status,
      headers: {
        // Slug availability is volatile by design, never cache.
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const slug = ((await ctx.params)?.slug ?? "").trim();
  const shape = validateSlug(slug);
  if (!shape.ok) {
    // 200 (not 4xx) so the form's fetch never throws, the body
    // carries the verdict. Returning the reason still tells the UI
    // what to say.
    return jsonResponse(false, shape.reason);
  }
  try {
    const persistence = getPersistence();
    const existing = persistence.getBySlug(slug);
    if (existing) return jsonResponse(false, "taken");
    return jsonResponse(true, "ok");
  } catch (err) {
    // If the schema isn't migrated yet, treat as "ok" with a server
    // log so signup isn't blocked in early-boot scenarios. The POST
    // handler is the source of truth on conflicts anyway.
    // eslint-disable-next-line no-console
    console.error("syndicate available check failed", err);
    return jsonResponse(true, "ok");
  }
}
