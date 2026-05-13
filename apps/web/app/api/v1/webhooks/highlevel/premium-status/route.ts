/**
 * POST /api/v1/webhooks/highlevel/premium-status
 *
 * The single inbound integration point between the HighLevel commercial
 * automation system and the Tournamental codebase. HL fires this
 * webhook from a workflow when a syndicate's subscription state
 * changes (Stripe checkout completed, payment failed, subscription
 * cancelled, etc.). The codebase responds by flipping the syndicate's
 * `tier` flag and persisting opaque HL identifiers.
 *
 * Architectural rule: this endpoint is the *only* place commercial
 * state crosses the boundary into the codebase. The codebase never
 * calls Stripe, never tracks subscription lifecycles, never knows
 * about prices. HL owns all of that.
 *
 * Request body (set up in HL workflow's webhook action):
 *   {
 *     "slug": "georgefm",
 *     "tier": "premium" | "past_due" | "free",
 *     "hl_location_id": "abc123..." | null,
 *     "hl_subscription_id": "sub_..." | null
 *   }
 *
 * Auth: shared secret in the `x-hl-webhook-secret` header, compared
 * with `HL_WEBHOOK_SECRET` env var in constant time. HL's webhook
 * configuration supports arbitrary custom headers; set this on the
 * workflow's webhook action.
 *
 * Idempotent by design: receiving the same payload twice flips the
 * same row to the same state, no side effects.
 */

import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getPersistence, type SyndicateTier } from "@/lib/syndicate/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  slug: z.string().min(1).max(64),
  tier: z.enum(["free", "premium", "past_due"]),
  hl_location_id: z.string().min(1).max(64).nullable().optional(),
  hl_subscription_id: z.string().min(1).max(64).nullable().optional(),
});

function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.HL_WEBHOOK_SECRET;
  // Refuse to operate if the secret is unset rather than failing open.
  // Tim sets HL_WEBHOOK_SECRET on the deployment; HL workflow sets the
  // same value in its webhook header config.
  if (!expected || expected.length < 16) {
    return jsonResponse({ error: "webhook_disabled" }, 503);
  }

  const provided = req.headers.get("x-hl-webhook-secret");
  if (!provided || !safeStringEqual(provided, expected)) {
    return jsonResponse({ error: "unauthorised" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
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

  const { slug, tier, hl_location_id, hl_subscription_id } = parsed.data;
  const persistence = getPersistence();
  const row = persistence.setTierBySlug({
    slug,
    tier: tier as SyndicateTier,
    hl_location_id: hl_location_id ?? null,
    hl_subscription_id: hl_subscription_id ?? null,
  });

  if (!row) {
    // HL fired the webhook for a slug that doesn't exist on our side.
    // 404 so the HL workflow can branch on the error and alert an
    // operator, but never 500 because retries from a misconfigured
    // workflow would hammer us.
    return jsonResponse({ error: "syndicate_not_found", slug }, 404);
  }

  return jsonResponse(
    {
      ok: true,
      slug: row.slug,
      tier: row.tier,
      hl_location_id: row.hl_location_id,
      hl_premium_since: row.hl_premium_since,
    },
    200,
  );
}
