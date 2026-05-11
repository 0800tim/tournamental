/**
 * /api/news, Next route handler that proxies the news-aggregator
 * service. Used by the home-page NewsStrip and any other surface that
 * wants the live feed without exposing the internal port.
 *
 * Cache: short edge cache + SWR. Falls through to an empty payload on
 * upstream failure so the strip renders an empty state rather than a
 * 5xx.
 */
import { NextResponse, type NextRequest } from "next/server";

const UPSTREAM_DEFAULT = "http://127.0.0.1:3402";
const UPSTREAM = (
  process.env.NEWS_AGG_URL ??
  process.env.NEXT_PUBLIC_NEWS_AGG_URL ??
  UPSTREAM_DEFAULT
).replace(/\/$/, "");

const ALLOWED = new Set(["limit", "since", "source", "lang", "tag"]);

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
};

const FAIL_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const incoming = new URL(req.url);
  const params = new URLSearchParams();
  for (const [k, v] of incoming.searchParams.entries()) {
    if (ALLOWED.has(k)) params.set(k, v);
  }
  if (!params.has("limit")) params.set("limit", "8");
  if (!params.has("lang")) params.set("lang", "en");

  const upstream = `${UPSTREAM}/v1/news?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6_000);
    const r = await fetch(upstream, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "application/json" },
      next: { revalidate: 120 },
    }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      return NextResponse.json(
        { items: [], total: 0, error: `upstream_${r.status}` },
        { headers: FAIL_HEADERS },
      );
    }
    const j = await r.json();
    return NextResponse.json(j, { headers: CACHE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { items: [], total: 0, error: err instanceof Error ? err.message : "upstream_unreachable" },
      { headers: FAIL_HEADERS },
    );
  }
}
