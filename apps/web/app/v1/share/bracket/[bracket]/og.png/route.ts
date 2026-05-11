/**
 * `/v1/share/bracket/:bracketId/og.png`, the 1200×630 Open Graph
 * unfurl variant. Always landscape, always PNG. Used by Twitter /
 * Facebook / Telegram preview cards on shared bracket URLs.
 *
 * Same param surface as the sibling `[bracket]` route, `size=` is
 * ignored here because the OG aspect ratio is fixed.
 */

import type { NextRequest } from "next/server";

import { renderBracketShareCard } from "@tournamental/social-cards";

import {
  inputFromSearchParams,
  isValidBracketId,
} from "@/lib/share/bracket-share-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { bracket: string };
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const raw = decodeURIComponent(ctx.params.bracket);
  // Strip a stray .png/.mp4 if the caller forgot to use the bare id.
  const stripped = raw.replace(/\.(png|mp4)$/, "");
  if (!isValidBracketId(stripped)) {
    return new Response(
      JSON.stringify({ error: "invalid_bracket_id", segment: ctx.params.bracket }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }
  try {
    const url = new URL(req.url);
    const input = inputFromSearchParams({ bracketId: stripped, searchParams: url.searchParams });
    const png = await renderBracketShareCard({ ...input, size: "landscape" });
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="bracket-${stripped}-og.png"`,
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=604800",
        "x-vtorn-share-format": "og",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "share_og_render_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }
}
