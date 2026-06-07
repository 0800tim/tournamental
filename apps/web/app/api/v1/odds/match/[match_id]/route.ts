/**
 * GET /api/v1/odds/match/:match_id , thin proxy to the game-service
 * /v1/odds/match/:match_id endpoint. Returns latest Polymarket-derived
 * home/draw/away implied probabilities for the requested fixture.
 *
 * Accepts both the raw integer string ("1".."72") and the canonical
 * `wc2026-mNNN` form , the upstream normalises both.
 *
 * Edge-cached at the Next layer (public, s-maxage=60, SWR=300).
 *
 * Spec: 2026-06-08 Polymarket odds endpoint brief.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gameUrl(): string {
  return (
    process.env.GAME_SERVICE_URL ??
    process.env.GAME_SERVICE_INTERNAL_URL ??
    process.env.GAME_BASE_URL ??
    "http://127.0.0.1:3361"
  );
}

const FALLBACK_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

interface RouteContext {
  params: { match_id?: string } | Promise<{ match_id?: string }>;
}

export async function GET(
  _req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const params = await Promise.resolve(ctx.params);
  const matchId = encodeURIComponent((params?.match_id ?? "").trim());
  if (!matchId) {
    return new Response(
      JSON.stringify({ error: "invalid_match_id" }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${gameUrl()}/v1/odds/match/${matchId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "no_market" }),
      {
        status: 404,
        headers: {
          "content-type": "application/json",
          "cache-control": FALLBACK_CACHE,
        },
      },
    );
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control":
        upstream.headers.get("cache-control") ?? FALLBACK_CACHE,
    },
  });
}
