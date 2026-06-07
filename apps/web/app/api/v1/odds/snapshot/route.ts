/**
 * GET /api/v1/odds/snapshot , thin proxy to the game-service
 * /v1/odds/snapshot endpoint. The browser-swarm /run page hits this once
 * at load to pull both per-match moneyline odds and the tournament-winner
 * market in a single round trip.
 *
 * Edge-cached at the Next layer with the same headers the upstream
 * sets (public, s-maxage=60, stale-while-revalidate=300).
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

export async function GET(): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${gameUrl()}/v1/odds/snapshot`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({
        matches: {},
        tournament_winner: [],
        source: "polymarket",
        generated_at: Date.now(),
      }),
      {
        status: 200,
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
