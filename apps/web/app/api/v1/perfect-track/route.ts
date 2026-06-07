/**
 * GET /api/v1/perfect-track, thin proxy to the game-service
 * /v1/perfect-track aggregate endpoint used by the leaderboard badge.
 *
 * Edge-cached at the Next layer with the same headers the upstream
 * sets so the badge poll never pummels the origin.
 *
 * Spec: A13 task brief.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gameUrl(): string {
  return (
    process.env.GAME_SERVICE_URL ??
    process.env.GAME_SERVICE_INTERNAL_URL ??
    "http://localhost:3360"
  );
}

export async function GET(): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${gameUrl()}/v1/perfect-track`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({
        highest_match: null,
        total_alive: 0,
        operator_count: 0,
        rows: [],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "public, s-maxage=30, stale-while-revalidate=120",
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
        upstream.headers.get("cache-control") ??
        "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
