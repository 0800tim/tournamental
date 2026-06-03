/**
 * /api/share/qr/[guid] — minimal PNG QR for the share landing URL.
 *
 * Lives outside the molecule-capture composer so the client can fetch
 * just the QR (50–80 px, ~600-byte PNG) once per share session and
 * cache it in memory. Keeping the QR off the molecule-page chunk is the
 * cheapest way to honour the +20 kB bundle delta budget: the `qrcode`
 * npm package is ~30 kB gzipped on its own and can't be tree-shaken
 * cleanly because it pulls in its `browser/qrcode` toString pipeline.
 *
 * Cache: 24h on the CDN — the QR is a pure function of guid + size +
 * palette and the guid is itself opaque, so we get cheap reuse across
 * captures for the same user / share session. Per the caching matrix
 * in docs/22-deployment-and-tunnels.md (long edge cache + immutable).
 */

import type { NextRequest } from "next/server";

import { renderQrPng } from "@tournamental/social-cards/canvas";

export const runtime = "nodejs";

const GUID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ guid: string }> },
): Promise<Response> {
  const guid = (await ctx.params).guid;
  if (!guid || !GUID_RE.test(guid)) {
    return new Response("invalid guid", { status: 400 });
  }
  const sizeParam = req.nextUrl.searchParams.get("size");
  let size = 96;
  if (sizeParam) {
    const n = parseInt(sizeParam, 10);
    if (Number.isFinite(n)) size = Math.min(256, Math.max(48, n));
  }
  const url = `https://play.tournamental.com/s/${guid}`;
  try {
    const png = await renderQrPng(url, size);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        // 24h edge cache + 1h SWR — the QR is content-addressable in
        // practice (guid is stable per bracket).
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600, immutable",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "qr_failed", {
      status: 500,
    });
  }
}
