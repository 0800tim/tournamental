/**
 * GET /api/healthz
 *
 * Static "the Next.js process is up and serving" probe. Used by:
 *   - infra/deploy/lib/smoke.ts after a build, to confirm the staging
 *     slot can accept traffic before we swap prod to it.
 *   - infra/deploy/promote-to-prod.ts post-swap, to verify the new prod
 *     slot is serving HTTP 200 (rolls back on 5xx).
 *   - Cloudflare Tunnel + uptime monitors externally.
 *
 * Intentionally minimal: no DB hit, no auth probe, no header sniff.
 * The point is to confirm the runtime is alive, not that downstream
 * services are. App-specific deep checks should live on dedicated
 * endpoints (/api/v1/healthz or per-service /healthz).
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET(): NextResponse {
  return NextResponse.json(
    { ok: true, service: "vtorn-web", at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
