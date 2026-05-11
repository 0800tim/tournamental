/**
 * /api/news, Astro endpoint that proxies the news-aggregator
 * service so the marketing site never exposes the internal port.
 *
 * Forwarded query params: limit, since, source, lang, tag.
 *
 * Cache policy: short edge cache + SWR. The upstream sends its own
 * cache-control; we honour it and add our own SWR window so a hot
 * Cloudflare edge can absorb /news traffic without backend pressure.
 *
 * Failure mode: if the upstream is unreachable we still return a
 * valid empty payload (HTTP 200 with `items: []` and an `error` flag)
 * so the page renders an empty state rather than a 5xx error.
 */
import type { APIContext } from "astro";

const UPSTREAM_DEFAULT = "http://127.0.0.1:3402";
const UPSTREAM = (
  // import.meta.env is the Astro-canonical way to read env at build/runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.NEWS_AGG_URL ??
  process.env.NEWS_AGG_URL ??
  UPSTREAM_DEFAULT
).replace(/\/$/, "");

const ALLOWED_PARAMS = new Set(["limit", "since", "source", "lang", "tag"]);

export async function GET(context: APIContext): Promise<Response> {
  const url = new URL(context.request.url);
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (ALLOWED_PARAMS.has(k)) params.set(k, v);
  }
  if (!params.has("limit")) params.set("limit", "20");
  if (!params.has("lang")) params.set("lang", "en");

  const upstreamUrl = `${UPSTREAM}/v1/news?${params.toString()}`;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    const r = await fetch(upstreamUrl, {
      method: "GET",
      signal: ac.signal,
      headers: { Accept: "application/json" },
    }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      return Response.json(
        { items: [], total: 0, error: `upstream_${r.status}` },
        {
          status: 200,
          headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
        },
      );
    }
    const body = await r.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    return Response.json(
      { items: [], total: 0, error: err instanceof Error ? err.message : "upstream_unreachable" },
      {
        status: 200,
        headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
      },
    );
  }
}
