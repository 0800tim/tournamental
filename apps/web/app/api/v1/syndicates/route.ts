/**
 * POST /api/v1/syndicates, create a syndicate (a "pool" of predictors).
 *
 * Validation: zod against `createSyndicateInputSchema` (see
 * `lib/syndicate/schema.ts`).
 *   - 400 on malformed input (bad email, malformed slug, etc.).
 *   - 409 with `{ reason: "reserved" }` when the slug is on the blocklist.
 *   - 409 with `{ reason: "taken" }` when another syndicate owns the slug.
 *   - 200 with the created row on success.
 *
 * GoHighLevel push: best-effort. Never blocks the response. On failure
 * (timeout, non-2xx, network) the payload is enqueued in
 * `syndicates_pending_ghl` for a daily retry cron to pick up.
 *
 * Notes for future migration:
 *   - The `/s/<slug>` landing page reads from `syndicates.slug` via the
 *     shared SQLite file (see `apps/game/migrations/0003_syndicates.sql`).
 *   - When the crm-bridge service stabilises, replace the direct GHL
 *     call with a POST to `crm-bridge:/v1/events/syndicate-owner`. The
 *     fetch glue here is intentionally narrow to make that swap easy.
 */

import type { NextRequest } from "next/server";
import { ZodError } from "zod";

import { createSyndicateInputSchema } from "@/lib/syndicate/schema";
import { isReservedSlug } from "@/lib/syndicate/reserved-slugs";
import { getPersistence } from "@/lib/syndicate/persistence";
import { buildGhlContactPayload, pushToGhl, type GhlStatus } from "@/lib/syndicate/ghl";
import { newShareGuid, newSyndicateId } from "@/lib/syndicate/ids";
import { invalidateSyndicateOgCache } from "@/app/api/og/syndicate/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_SHARE_HOST =
  process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  let input;
  try {
    input = createSyndicateInputSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return jsonResponse(
        {
          error: "invalid_payload",
          issues: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        },
        400,
      );
    }
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  if (isReservedSlug(input.slug)) {
    return jsonResponse(
      {
        error: "slug_unavailable",
        reason: "reserved",
        message: "That name is reserved. Try another.",
      },
      409,
    );
  }

  const persistence = getPersistence();
  const existing = persistence.getBySlug(input.slug);
  if (existing) {
    return jsonResponse(
      {
        error: "slug_unavailable",
        reason: "taken",
        message: "That syndicate name is already taken. Try another.",
      },
      409,
    );
  }

  const syndicateId = newSyndicateId();
  const shareGuid = newShareGuid();

  let row;
  try {
    row = persistence.createSyndicate({
      id: syndicateId,
      slug: input.slug,
      name: input.name,
      tournament_id: input.tournament_id,
      owner_email: input.owner_email,
      owner_phone: input.owner_phone,
      owner_user_id: null, // No auth on the public signup yet.
      owner_handle: input.owner_handle ?? null,
      size_band: input.size_band,
      topic: input.topic ?? null,
      marketing_consent: input.marketing_consent,
      share_guid: shareGuid,
      is_public: input.is_public,
      requires_approval: input.requires_approval,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // SQLite UNIQUE constraint on slug → race with another creator.
    if (/UNIQUE.*slug/i.test(message)) {
      return jsonResponse(
        {
          error: "slug_unavailable",
          reason: "taken",
          message: "That syndicate name was just taken. Try another.",
        },
        409,
      );
    }
    // eslint-disable-next-line no-console
    console.error("syndicate create failed", err);
    return jsonResponse({ error: "persist_failed" }, 500);
  }

  // Pop any stale OG image for this slug so the first share-crawler
  // hit re-renders against the freshly-created row. Best-effort; we
  // don't await the operation because OG cache state can never block
  // a successful create.
  void invalidateSyndicateOgCache(row.slug);

  // GHL push, best-effort, never blocks the response.
  let ghlStatus: GhlStatus = "queued";
  try {
    const result = await pushToGhl(row);
    ghlStatus = result.status;
    if (result.status === "failed") {
      // eslint-disable-next-line no-console
      console.warn("syndicate ghl push failed; queued for retry", {
        syndicate_id: row.id,
        error: result.error,
      });
      const { body } = buildGhlContactPayload(row);
      persistence.enqueueGhlRetry({
        syndicate_id: row.id,
        payload: body,
        error: result.error ?? "unknown",
      });
    } else if (result.status === "skipped") {
      // eslint-disable-next-line no-console
      console.warn("syndicate ghl push skipped (GHL_API_KEY unset)", {
        syndicate_id: row.id,
      });
    }
  } catch (err) {
    // Defensive, pushToGhl should not throw, but if it does, treat
    // the same as a failure and enqueue.
    // eslint-disable-next-line no-console
    console.warn("syndicate ghl push threw; queued for retry", err);
    const { body } = buildGhlContactPayload(row);
    persistence.enqueueGhlRetry({
      syndicate_id: row.id,
      payload: body,
      error: err instanceof Error ? err.message : String(err),
    });
    ghlStatus = "failed";
  }

  return jsonResponse(
    {
      syndicate_id: row.id,
      slug: row.slug,
      share_guid: row.share_guid,
      share_url: `${PUBLIC_SHARE_HOST}/s/${row.slug}`,
      ghl_status: ghlStatus,
    },
    200,
  );
}
