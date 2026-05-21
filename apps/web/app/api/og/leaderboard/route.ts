/**
 * /api/og/leaderboard, OG image generator for "Share my rank" cards.
 *
 * Renders a rank-themed card matching the editorial /s/<slug> and OG
 * bracket styling: gold ball-mark, charcoal canvas, Fraunces display
 * type. The card surfaces the user's rank, handle, points, and the
 * percentile (or scope label, e.g. "TOP 100") so a recipient sees a
 * crisp brag-card in their unfurl preview (Tim 2026-05-22).
 *
 * Doc reference: docs/24 §Sharing names "leaderboard_climbed" as a
 * top-3 viral surface.
 *
 * Sizes: landscape (1200×630), portrait (1080×1350), square (1080×1080).
 *
 * Query params:
 *   - rank          (required), integer >= 1
 *   - handle        (required, fallback "Predictor")
 *   - points        (optional, integer >= 0)
 *   - percentile    (optional, integer 0-100; "top X%" line)
 *   - scope         (optional), short label e.g. "FRIENDS" / "GLOBAL" /
 *                   "THIS WEEK". Defaults to "GLOBAL".
 *   - tournament    (optional), defaults to "FWC2026".
 *   - size          (optional), landscape | portrait | square.
 *
 * Caching: short edge TTL + SWR. The rank changes minute-by-minute as
 * matches finalise, so an immutable cache would lie. The render path
 * stays cheap, the fonts are module-scoped.
 *
 * Rendering: satori (JSX -> SVG) + @resvg/resvg-js (SVG -> PNG).
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LbSize = "landscape" | "portrait" | "square";

const SIZES: Readonly<Record<LbSize, { width: number; height: number }>> = {
  landscape: { width: 1200, height: 630 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
};

const COLOUR_BG = "#15151a";
const COLOUR_FG_STRONG = "#ffffff";
const COLOUR_FG_MUTED = "#a3a3ad";
const COLOUR_GOLD = "#dca94b";
const COLOUR_GOLD_DEEP = "#9a6a17";

interface FontBundle {
  readonly fraunces500: ArrayBuffer;
  readonly fraunces700: ArrayBuffer;
  readonly mono: ArrayBuffer;
}
let fontCache: FontBundle | null = null;

async function loadFonts(): Promise<FontBundle> {
  if (fontCache) return fontCache;
  const fontDir = join(process.cwd(), "public", "fonts");
  const monoCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  const [fraunces500, fraunces700, mono] = await Promise.all([
    readBuffer(join(fontDir, "Fraunces-500.ttf")),
    readBuffer(join(fontDir, "Fraunces-700.ttf")),
    readFirst(monoCandidates),
  ]);
  fontCache = { fraunces500, fraunces700, mono };
  return fontCache;
}

async function readBuffer(path: string): Promise<ArrayBuffer> {
  const data = await fs.readFile(path);
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

async function readFirst(paths: readonly string[]): Promise<ArrayBuffer> {
  for (const p of paths) {
    try {
      return await readBuffer(p);
    } catch {
      /* try next */
    }
  }
  throw new Error("no mono font available for satori");
}

interface RenderArgs {
  readonly rank: number;
  readonly handle: string;
  readonly points: number;
  readonly percentile: number | null;
  readonly scope: string;
  readonly tournament: string;
  readonly size: LbSize;
}

function parseSize(req: NextRequest): LbSize {
  const url = new URL(req.url);
  const raw = url.searchParams.get("size");
  if (raw === "portrait" || raw === "square") return raw;
  return "landscape";
}

function parseArgs(req: NextRequest, size: LbSize): RenderArgs {
  const url = new URL(req.url);
  const rank = Math.max(1, Math.floor(Number(url.searchParams.get("rank") ?? 0))) || 1;
  const handle =
    (url.searchParams.get("handle") ?? "").trim().slice(0, 24) || "Predictor";
  const points = Math.max(0, Math.floor(Number(url.searchParams.get("points") ?? 0))) || 0;
  const pctRaw = url.searchParams.get("percentile");
  const percentile = pctRaw === null ? null : Math.max(0, Math.min(100, Math.floor(Number(pctRaw))));
  const scope = (url.searchParams.get("scope") ?? "GLOBAL").trim().slice(0, 16).toUpperCase() || "GLOBAL";
  const tournament = (url.searchParams.get("tournament") ?? "FWC2026").trim().slice(0, 16).toUpperCase() || "FWC2026";
  return { rank, handle, points, percentile, scope, tournament, size };
}

export async function GET(req: NextRequest): Promise<Response> {
  const size = parseSize(req);
  const args = parseArgs(req, size);
  try {
    const png = await renderPNG(args);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="leaderboard-${args.rank}-${args.size}.png"`,
        "cache-control": "public, s-maxage=60, stale-while-revalidate=600",
        "x-vtorn-og-size": args.size,
      },
    });
  } catch (err) {
    return new Response(renderFallbackPng() as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-og-fallback": "1",
        "x-og-error":
          err instanceof Error ? err.message.slice(0, 200) : "render_failed",
      },
    });
  }
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

async function renderPNG(args: RenderArgs): Promise<Buffer> {
  const { width, height } = SIZES[args.size];
  const fonts = await loadFonts();
  const padding = args.size === "landscape" ? 72 : 88;
  const scale = args.size === "landscape" ? 1 : args.size === "square" ? 1.05 : 1.15;

  // Big rank glyph fills the canvas. Five digits squeezes; one digit
  // looks tiny — so scale inverse to digit count.
  const rankStr = String(args.rank);
  const rankDigits = rankStr.length;
  const rankFont = Math.round(
    (rankDigits >= 4 ? 260 : rankDigits === 3 ? 320 : rankDigits === 2 ? 380 : 440) * scale,
  );

  const datelineFont = Math.round(24 * scale);
  const handleFont = Math.round(48 * scale);
  const labelFont = Math.round(20 * scale);
  const statFont = Math.round(46 * scale);
  const footerFont = Math.round(22 * scale);

  const dateline = `${args.tournament} · ${args.scope} LEADERBOARD`;
  const ordinal = ordinalSuffix(args.rank);
  const pctLine =
    args.percentile !== null && args.percentile <= 50
      ? `Top ${args.percentile}%`
      : args.percentile !== null
        ? `${args.percentile}th percentile`
        : null;
  const url = `play.tournamental.com/leaderboard`;
  const ballSize = Math.round(86 * scale);

  const tree = {
    type: "div",
    props: {
      style: {
        width,
        height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: COLOUR_BG,
        padding,
        color: COLOUR_FG_STRONG,
        fontFamily: "Fraunces",
        position: "relative",
      },
      children: [
        // top: gold ball + dateline
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              gap: Math.round(24 * scale),
            },
            children: [
              renderGoldBall(ballSize),
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "DejaVuMono",
                    fontSize: datelineFont,
                    color: COLOUR_GOLD,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.7em",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          width: Math.round(40 * scale),
                          height: 1,
                          background: COLOUR_GOLD,
                        },
                      },
                    },
                    dateline,
                  ],
                },
              },
            ],
          },
        },

        // middle: rank + handle + percentile
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              justifyContent: "center",
              gap: Math.round(8 * scale),
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "baseline",
                    gap: Math.round(14 * scale),
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "Fraunces",
                          fontSize: rankFont,
                          fontWeight: 700,
                          color: COLOUR_GOLD,
                          lineHeight: 0.86,
                          letterSpacing: "-0.03em",
                          fontFeatureSettings: '"tnum" 1, "lnum" 1',
                        },
                        children: rankStr,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "Fraunces",
                          fontSize: Math.round(rankFont * 0.34),
                          fontWeight: 500,
                          color: COLOUR_GOLD_DEEP,
                          lineHeight: 1,
                        },
                        children: ordinal,
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Fraunces",
                    fontSize: handleFont,
                    color: COLOUR_FG_STRONG,
                    fontWeight: 500,
                    marginTop: Math.round(10 * scale),
                  },
                  children: `@${args.handle}`,
                },
              },
              ...(pctLine
                ? [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "DejaVuMono",
                          fontSize: labelFont,
                          color: COLOUR_FG_MUTED,
                          letterSpacing: "0.18em",
                          textTransform: "uppercase",
                          marginTop: Math.round(6 * scale),
                        },
                        children: pctLine.toUpperCase(),
                      },
                    },
                  ]
                : []),
            ],
          },
        },

        // bottom: points + footer
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "Fraunces",
                          fontSize: statFont,
                          fontWeight: 500,
                          color: COLOUR_GOLD,
                          lineHeight: 0.95,
                          fontFeatureSettings: '"tnum" 1, "lnum" 1',
                        },
                        children: args.points.toLocaleString(),
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "DejaVuMono",
                          fontSize: labelFont,
                          color: COLOUR_FG_MUTED,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          fontWeight: 500,
                        },
                        children: "POINTS",
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "DejaVuMono",
                    fontSize: footerFont,
                    color: COLOUR_FG_MUTED,
                    letterSpacing: "0.08em",
                  },
                  children: url,
                },
              },
            ],
          },
        },
      ],
    },
  } as const;

  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: [
      { name: "Fraunces", data: fonts.fraunces500, weight: 500, style: "normal" },
      { name: "Fraunces", data: fonts.fraunces700, weight: 700, style: "normal" },
      { name: "DejaVuMono", data: fonts.mono, weight: 400, style: "normal" },
      { name: "DejaVuMono", data: fonts.mono, weight: 500, style: "normal" },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } })
    .render()
    .asPng();
  return Buffer.from(png);
}

function renderGoldBall(size: number): unknown {
  const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ball" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stop-color="#f0d27a" />
          <stop offset="55%" stop-color="${COLOUR_GOLD}" />
          <stop offset="100%" stop-color="${COLOUR_GOLD_DEEP}" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#ball)" stroke="#6b4708" stroke-width="2" />
      <polygon points="50,30 65,42 60,60 40,60 35,42" fill="#15151a" opacity="0.55" />
      <polygon points="20,38 33,32 38,44 28,52 18,46" fill="#15151a" opacity="0.32" />
      <polygon points="82,38 87,46 78,52 68,44 73,32" fill="#15151a" opacity="0.32" />
      <polygon points="50,72 60,80 50,90 40,80" fill="#15151a" opacity="0.32" />
    </svg>
  `.trim();
  return {
    type: "img",
    props: {
      src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      width: size,
      height: size,
    },
  };
}

function renderFallbackPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
}
