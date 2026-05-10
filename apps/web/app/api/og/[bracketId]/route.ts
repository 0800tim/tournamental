/**
 * /api/og/[bracketId] — canonical OG image generator for shared brackets.
 *
 * Path-based variant of the older query-param `/api/og/bracket`. Uses
 * the shared `@vtorn/social-cards` `bracket-pick` card kind so the
 * visual identity stays in lockstep across every surface.
 *
 * Until the persisted bracket service ships (PR #27), the route reads
 * the bracket payload (handle, winner, R16→QF→SF→FINAL route) from the
 * query string. The `bracketId` slug in the path is still meaningful:
 *  - It's a stable cache key (one disk file per id).
 *  - When the API lands, this handler swaps the query-string payload
 *    for a `fetch(`${API_BASE}/v1/brackets/${id}`)` call without a URL
 *    contract change for consumers.
 *
 * Cache: long edge cache + immutable per bracket id. Per docs/22.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { buildCard, type CardInput } from "@vtorn/social-cards";

import { decodeBracketPayload, type BracketSharePayload } from "@/lib/share/payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Best-effort font loader. Prefer the bundled package fonts if the user
 * has run `pnpm --filter @vtorn/social-cards run fetch:fonts`; otherwise
 * fall back to system DejaVu, then to anything we can find.
 */
async function loadFont(): Promise<{
  data: ArrayBuffer;
  name: string;
  weight: 400 | 700 | 900;
} | null> {
  // Try the social-cards bundled fonts first.
  const candidates: Array<{
    path: string;
    name: string;
    weight: 400 | 700 | 900;
  }> = [
    {
      path: join(process.cwd(), "..", "..", "packages", "social-cards", "fonts", "Inter-Bold.ttf"),
      name: "Inter",
      weight: 700,
    },
    {
      path: join(process.cwd(), "..", "..", "packages", "social-cards", "fonts", "Inter-Regular.ttf"),
      name: "Inter",
      weight: 400,
    },
    {
      path: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      name: "Inter",
      weight: 700,
    },
    {
      path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      name: "Inter",
      weight: 400,
    },
  ];
  for (const c of candidates) {
    try {
      const data = await fs.readFile(c.path);
      return {
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
        name: c.name,
        weight: c.weight,
      };
    } catch {
      // try next
    }
  }
  return null;
}

async function loadAllFonts(): Promise<
  Array<{ name: string; data: ArrayBuffer; weight: 400 | 700 | 900; style: "normal" }>
> {
  // Load whatever weights we can find — satori needs at least one but
  // works much better with regular + bold for nice contrast.
  const out: Array<{
    name: string;
    data: ArrayBuffer;
    weight: 400 | 700 | 900;
    style: "normal";
  }> = [];
  const wanted: Array<{ path: string; weight: 400 | 700 | 900 }> = [
    {
      path: join(process.cwd(), "..", "..", "packages", "social-cards", "fonts", "Inter-Regular.ttf"),
      weight: 400,
    },
    {
      path: join(process.cwd(), "..", "..", "packages", "social-cards", "fonts", "Inter-Bold.ttf"),
      weight: 700,
    },
    {
      path: join(process.cwd(), "..", "..", "packages", "social-cards", "fonts", "Inter-Black.ttf"),
      weight: 900,
    },
    { path: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", weight: 400 },
    { path: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", weight: 700 },
  ];
  for (const w of wanted) {
    try {
      const data = await fs.readFile(w.path);
      const ab = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      // Only push one per weight — first match wins.
      if (!out.some((x) => x.weight === w.weight)) {
        out.push({ name: "Inter", data: ab, weight: w.weight, style: "normal" });
      }
    } catch {
      // try next
    }
  }
  return out;
}

export interface RenderResult {
  readonly png: Buffer;
  readonly bracketId: string;
}

export async function renderBracketOG(payload: BracketSharePayload): Promise<RenderResult> {
  const fonts = await loadAllFonts();
  if (fonts.length === 0) {
    const single = await loadFont();
    if (!single) {
      throw new Error(
        "no font available for satori; vendor a TTF in packages/social-cards/fonts/ or install DejaVu",
      );
    }
    fonts.push({ name: single.name, data: single.data, weight: single.weight, style: "normal" });
  }

  const cardInput: CardInput = {
    kind: "bracket-pick",
    data: {
      userHandle: payload.handle,
      userId: payload.bracketId, // bracketId double-duties as referral key until auth lands
      tournamentName: payload.tournamentName,
      winnerCode: payload.winnerCode,
      winnerName: payload.winnerName,
      winnerFlagEmoji: payload.winnerFlagEmoji,
      route: payload.route.map((r) => ({
        stage: r.stage,
        teamCode: r.teamCode,
        teamName: r.teamName,
        flagEmoji: r.flagEmoji,
      })),
      tagline: payload.tagline,
      longShotCount: payload.longShotCount,
    },
  };

  const tree = buildCard(cardInput, "og");

  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    background: "rgba(10,14,26,1)",
  })
    .render()
    .asPng();

  return { png: Buffer.from(png), bracketId: payload.bracketId };
}

async function tryDiskCache(bracketId: string, png: Buffer): Promise<void> {
  const safe = bracketId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const dir = join(process.cwd(), "public", "og", "bracket");
  const file = join(dir, `${safe}.png`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, png);
  } catch {
    // best-effort
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: { bracketId: string } },
): Promise<Response> {
  const bracketId = ctx.params.bracketId ?? "default";
  if (!bracketId.match(/^[a-zA-Z0-9_-]{1,128}$/)) {
    return new Response(
      JSON.stringify({ error: "invalid_bracket_id" }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }
  try {
    const url = new URL(req.url);
    const payload = decodeBracketPayload(bracketId, url.searchParams);
    const { png } = await renderBracketOG(payload);

    void tryDiskCache(bracketId, png);

    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        // 1 hour public + 24h stale-while-revalidate per the mission brief.
        // (Same shape as the existing /api/og/bracket route — id is stable
        // so this is safe to long-cache.)
        "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "og_render_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      },
    );
  }
}
