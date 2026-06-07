/**
 * GET /api/v1/swarms/[operator_id], thin proxy to the game-service
 * /v1/swarms/<operator_id> aggregate endpoint.
 *
 * Edge-cached at the Next layer with the same headers the upstream
 * sets so Cloudflare's edge serves repeat hits without touching the
 * Node origin. ETag passthrough preserves the 304 fast-path.
 *
 * Auth-free read because the upstream endpoint is fully public.
 *
 * Spec: A13 task brief.
 */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX64 = /^[0-9a-f]{64}$/;

function gameUrl(): string {
  return (
    process.env.GAME_SERVICE_URL ??
    process.env.GAME_SERVICE_INTERNAL_URL ??
    "http://localhost:3360"
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: { operator_id: string } },
): Promise<Response> {
  const operatorId = (ctx.params.operator_id ?? "").toLowerCase();
  if (!HEX64.test(operatorId)) {
    return new Response(JSON.stringify({ error: "invalid_operator_id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const ifNoneMatch = req.headers.get("if-none-match");
  let upstream: Response;
  try {
    upstream = await fetch(`${gameUrl()}/v1/swarms/${operatorId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}),
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  if (upstream.status === 304) {
    return new Response(null, {
      status: 304,
      headers: {
        "cache-control":
          upstream.headers.get("cache-control") ??
          "public, s-maxage=60, stale-while-revalidate=300",
        etag: upstream.headers.get("etag") ?? "",
      },
    });
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control":
        upstream.headers.get("cache-control") ??
        "public, s-maxage=60, stale-while-revalidate=300",
      ...(upstream.headers.get("etag")
        ? { etag: upstream.headers.get("etag")! }
        : {}),
    },
  });
}
