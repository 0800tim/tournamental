/**
 * /api/og/bracket — OG image generator for shared brackets.
 *
 * Query params:
 *   - bracket_id (string, required)
 *   - handle (string, optional, the user's display name)
 *   - winner (string, optional, the user's predicted final winner)
 *   - locked (number, optional, kept as a query alias for back-compat — count of saved picks)
 *
 * Returns a 1200x630 PNG. Twitter Cards, Open Graph, Telegram preview
 * compatible. Cache-Control: long edge cache + immutable per bracket id.
 *
 * The image is generated via `satori` (JSX → SVG) + `@resvg/resvg-js`
 * (SVG → PNG). Both are pure Node — no headless browser, no external
 * service.
 *
 * In prod we cache the PNG to disk at
 * `apps/web/public/og/bracket/<bracket_id>.png` so the public URL hits
 * the static file on the second request. The cache is best-effort — if
 * disk write fails we still return the PNG inline.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

export const runtime = "nodejs";
// Long-cache per bracket_id — every committed bracket has its own image.
export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

async function loadFont(): Promise<ArrayBuffer> {
  // Use system Inter / Roboto if present; otherwise fall back to a
  // bundled OFL font. Phase 0 has no fonts vendored — for v0.1 we use
  // the default font satori ships in its docs example. If satori can't
  // find a font it'll throw, which we catch and return a fallback PNG.
  // Fonts directory is a follow-up task tracked in IDEAS.md.
  // For now, satori needs a font. Try a known path; else throw.
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  for (const path of candidates) {
    try {
      const data = await fs.readFile(path);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    } catch {
      // try next
    }
  }
  throw new Error("no system font available for satori; vendor a TTF in apps/web/public/fonts/");
}

interface OGParams {
  readonly bracket_id: string;
  readonly handle: string;
  readonly winner: string;
  readonly locked: number;
}

function parseParams(req: NextRequest): OGParams {
  const url = new URL(req.url);
  return {
    bracket_id: url.searchParams.get("bracket_id") ?? "default",
    handle: url.searchParams.get("handle") ?? "Anonymous",
    winner: url.searchParams.get("winner") ?? "TBD",
    locked: Number(url.searchParams.get("locked") ?? 0) || 0,
  };
}

async function renderPNG(params: OGParams): Promise<Buffer> {
  const fontData = await loadFont();
  const tree = {
    type: "div",
    props: {
      style: {
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #312e81 100%)",
        padding: 60,
        color: "white",
        fontFamily: "Inter",
      },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", alignItems: "center", justifyContent: "space-between" },
            children: [
              {
                type: "div",
                props: {
                  style: { fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" },
                  children: "VTourn · Bracket Prophet",
                },
              },
              {
                type: "div",
                props: {
                  style: { fontSize: 22, color: "#94a3b8" },
                  children: "FIFA World Cup 2026",
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: 12 },
            children: [
              {
                type: "div",
                props: {
                  style: { fontSize: 38, color: "#cbd5e1" },
                  children: `@${params.handle}`,
                },
              },
              {
                type: "div",
                props: {
                  style: { fontSize: 78, fontWeight: 800, letterSpacing: "-0.03em" },
                  children: `Picked ${params.winner} to lift the trophy`,
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid #334155",
              paddingTop: 24,
              fontSize: 22,
              color: "#94a3b8",
            },
            children: [
              {
                type: "div",
                props: {
                  children: `${params.locked} picks saved. Save yours before kickoff.`,
                },
              },
              {
                type: "div",
                props: {
                  style: { fontWeight: 600, color: "#facc15" },
                  children: "vtourn.com/world-cup-2026",
                },
              },
            ],
          },
        },
      ],
    },
  } as const;

  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: "Inter", data: fontData, weight: 700, style: "normal" }],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
  return Buffer.from(png);
}

async function tryDiskCache(bracket_id: string, png: Buffer): Promise<string | null> {
  const safe = bracket_id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const dir = join(process.cwd(), "public", "og", "bracket");
  const file = join(dir, `${safe}.png`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, png);
    return file;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const params = parseParams(req);
  try {
    const png = await renderPNG(params);
    void tryDiskCache(params.bracket_id, png); // fire-and-forget
    // Cast to BodyInit-compatible BlobPart. Node's Buffer is a Uint8Array
    // subclass; the TS DOM lib insists on the structural BodyInit shape.
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800, immutable",
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
