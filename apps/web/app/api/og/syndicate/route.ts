/**
 * /api/og/syndicate — OG image generator for syndicate share pages.
 *
 * Mirrors `/api/og/bracket` (see neighbouring directory) but the card
 * surfaces the syndicate identity instead of an individual user:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [V] Tournamental         FIFA World Cup 2026         │
 *   │                                                       │
 *   │  ARGENTINA POOL                                       │
 *   │  hosted by @messi_picks                               │
 *   │                                                       │
 *   │  8 members · 47 picks made                            │
 *   │                                                       │
 *   │ Join the pool — tournamental.com/s/argentina-pool     │
 *   └──────────────────────────────────────────────────────┘
 *
 * Query params:
 *   - slug (string, required) — the syndicate slug. We do a server-side
 *     lookup so the rendered image reflects the LIVE member count and
 *     picks-made figure, not whatever the caller passed.
 *
 * Returns a 1200x630 PNG. Cache-Control: short edge TTL +
 * stale-while-revalidate so the member count refreshes within ~1 min.
 * Disk-cache the rendered PNG under
 * `apps/web/public/og/syndicate/<slug>.png` so the second request hits
 * the static file.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { loadSyndicateBySlug } from "@/lib/syndicate/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

async function loadFont(): Promise<ArrayBuffer> {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  for (const path of candidates) {
    try {
      const data = await fs.readFile(path);
      return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
    } catch {
      // try next
    }
  }
  throw new Error(
    "no system font available for satori; vendor a TTF in apps/web/public/fonts/",
  );
}

interface RenderArgs {
  readonly name: string;
  readonly slug: string;
  readonly owner_handle: string;
  readonly member_count: number;
  readonly picks_made: number;
  readonly tournament_label: string;
}

async function renderPNG(args: RenderArgs): Promise<Buffer> {
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
        background:
          "linear-gradient(135deg, #0a0e1a 0%, #101626 60%, #1e2540 100%)",
        padding: 60,
        color: "white",
        fontFamily: "Inter",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                  },
                  children: "Tournamental · Syndicate",
                },
              },
              {
                type: "div",
                props: {
                  style: { fontSize: 22, color: "#94a3b8" },
                  children: args.tournament_label,
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
                  style: {
                    fontSize: 78,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                  },
                  children: args.name,
                },
              },
              {
                type: "div",
                props: {
                  style: { fontSize: 30, color: "#cdd5e7" },
                  children: `hosted by @${args.owner_handle}`,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    marginTop: 18,
                    fontSize: 34,
                    color: "#f5c542",
                    fontWeight: 600,
                  },
                  children: `${args.member_count} member${args.member_count === 1 ? "" : "s"} · ${args.picks_made} pick${args.picks_made === 1 ? "" : "s"} made`,
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
                props: { children: "Join the pool" },
              },
              {
                type: "div",
                props: {
                  style: { fontWeight: 600, color: "#7eb6e8" },
                  children: `tournamental.com/s/${args.slug}`,
                },
              },
            ],
          },
        },
      ],
    },
  } as const;

  const svg = await satori(
    tree as unknown as Parameters<typeof satori>[0],
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: "Inter", data: fontData, weight: 700, style: "normal" },
      ],
    },
  );
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

async function tryDiskCache(slug: string, png: Buffer): Promise<string | null> {
  const safe = slug.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const dir = join(process.cwd(), "public", "og", "syndicate");
  const file = join(dir, `${safe}.png`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, png);
    return file;
  } catch {
    return null;
  }
}

function renderFallbackPng(slug: string, message: string): Buffer {
  // 1x1 transparent PNG. Used when satori can't find a font in dev.
  // The route stays 200 because Open Graph crawlers downgrade
  // gracelessly on 5xx and we'd rather ship a tiny image than block
  // the share link rendering.
  void slug;
  void message;
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) {
    return new Response(
      JSON.stringify({ error: "slug_required" }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }

  const syndicate = await loadSyndicateBySlug(slug);
  if (!syndicate) {
    return new Response(
      JSON.stringify({ error: "syndicate_not_found", slug }),
      {
        status: 404,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }

  try {
    const png = await renderPNG({
      name: syndicate.name,
      slug: syndicate.slug,
      owner_handle: syndicate.owner_handle,
      member_count: syndicate.members.length,
      picks_made: syndicate.picks_made,
      tournament_label: syndicate.tournament_label,
    });
    void tryDiskCache(syndicate.slug, png);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control":
          "public, s-maxage=60, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const fallback = renderFallbackPng(
      syndicate.slug,
      err instanceof Error ? err.message : String(err),
    );
    return new Response(fallback as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-og-fallback": "1",
      },
    });
  }
}
