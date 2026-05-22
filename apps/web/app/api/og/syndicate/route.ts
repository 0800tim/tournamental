/**
 * /api/og/syndicate, OG image generator for syndicate share pages.
 *
 * Rebuilt 2026-05-21 to match the editorial /s/<slug> surface: gold
 * ball-mark + charcoal canvas + Fraunces display headline. The old
 * navy-radial + sky-blue chip + "FREE TO PLAY" bubble retired with
 * Job 1's editorial composition pass.
 *
 * Sizes (every social platform Tournamental needs to feed):
 *
 *   - landscape (default) -> 1200x630, X / FB / LinkedIn / Telegram.
 *   - portrait            -> 1080x1350, Instagram feed / Facebook.
 *   - square              -> 1080x1080, Instagram square / Slack / WhatsApp.
 *
 * Query params (all optional except `slug`):
 *   - slug          (required), the syndicate slug.
 *   - name          (optional), display-name override / fallback when
 *                                the syndicate isn't in the store yet.
 *   - member_count  (optional), integer >= 0; fallback for store miss.
 *   - tournament    (optional), defaults to "World Cup 2026".
 *   - size          (optional), landscape | portrait | square.
 *
 * Resolution order:
 *   1. `loadSyndicateBySlug(slug)`, the canonical store, when populated.
 *   2. Inline query-param hints, when the slug isn't in the store yet
 *      but the caller has the metadata. This keeps the route useful
 *      for previews and lets newly-signed-up syndicates render an OG
 *      card before the backend hydrates.
 *   3. A title-cased slug + zero members, last-resort placeholder so
 *      the route NEVER 404s. A poisoned 4xx in the CDN ruins every
 *      Open-Graph unfurl until the cache evicts.
 *
 * Caching:
 *   - On-disk PNG at `apps/web/public/og/syndicate/<slug>-<size>.png`
 *     so the second request hits the static-asset handler.
 *   - HTTP: short edge TTL + SWR so a live member count refreshes
 *     within ~1 minute. When the syndicate is in the store, freshness
 *     matters more than the immutability optimisation the bracket OG
 *     uses.
 *
 * Rendering: satori (JSX -> SVG) + @resvg/resvg-js (SVG -> PNG). Fonts
 * (Fraunces variable + DejaVu mono fallback for tabular numerals) are
 * cached in module scope so the hot path stays cheap.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { loadSyndicateBySlug, type SyndicateRecord } from "@/lib/syndicate/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyndicateSize = "landscape" | "portrait" | "square";

const SIZES: Readonly<Record<SyndicateSize, { width: number; height: number }>> = {
  landscape: { width: 1200, height: 630 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
};

const ALLOWED_SIZES: ReadonlySet<SyndicateSize> = new Set([
  "landscape",
  "portrait",
  "square",
]);

const DEFAULT_SIZE: SyndicateSize = "landscape";

// Brand tokens, mirrored from docs/BRAND.md §2 so the OG image reads
// against the same gold + charcoal palette as the live /s/<slug>
// surface. Kept inline (no CSS-var indirection) because satori paints
// its own style tree without inheriting from the page.
const COLOUR_BG = "#15151a"; // --vt-bg
const COLOUR_FG_STRONG = "#ffffff"; // --vt-fg-strong
const COLOUR_FG_MUTED = "#a3a3ad"; // --vt-fg-muted
const COLOUR_GOLD = "#dca94b"; // --vt-gold-400 (primary gold)
const COLOUR_GOLD_DEEP = "#9a6a17"; // --vt-gold-600 (stroke contrast)

// Module-scope font cache. Fraunces is the editorial display face; the
// mono fallback covers tabular numerals and the dateline at OG sizes.
//
// Satori (current release) supports TTF / OTF / WOFF only, NOT WOFF2.
// The browser-side font load uses the slimmer Fraunces-Variable.woff2;
// satori reads three static TTF cuts (500, 700, 500-italic) sourced
// from the canonical Google Fonts release of Fraunces so the parser
// doesn't trip on the variable-axis tables the way it does with the
// upstream Fraunces-Variable TTF.
interface FontBundle {
  readonly fraunces500: ArrayBuffer;
  readonly fraunces700: ArrayBuffer;
  readonly frauncesItalic500: ArrayBuffer;
  readonly mono: ArrayBuffer;
}
let fontCache: FontBundle | null = null;

async function loadFonts(): Promise<FontBundle> {
  if (fontCache) return fontCache;

  const fontDir = join(process.cwd(), "public", "fonts");
  const frauncesRegular = join(fontDir, "Fraunces-500.ttf");
  const frauncesBold = join(fontDir, "Fraunces-700.ttf");
  const frauncesItalic = join(fontDir, "Fraunces-500-Italic.ttf");

  // Mono fallback: any DejaVu / system mono buffer that satori can
  // load. Used for the dateline + footer URL + stat labels.
  const monoCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Menlo.ttc",
  ];

  const [fraunces500, fraunces700, frauncesItalic500, mono] = await Promise.all([
    readBuffer(frauncesRegular),
    readBuffer(frauncesBold),
    readBuffer(frauncesItalic),
    readFirst(monoCandidates),
  ]);

  fontCache = { fraunces500, fraunces700, frauncesItalic500, mono };
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
      // try next
    }
  }
  throw new Error(
    "no system mono font available for satori; install fonts-dejavu or vendor one in apps/web/public/fonts/",
  );
}

interface RenderArgs {
  readonly slug: string;
  readonly safeSlug: string;
  readonly name: string;
  readonly ownerHandle: string | null;
  readonly memberCount: number;
  readonly picksMade: number;
  readonly tournamentLabel: string;
  readonly size: SyndicateSize;
}

function parseSize(req: NextRequest): SyndicateSize {
  const url = new URL(req.url);
  const raw = url.searchParams.get("size");
  return raw && ALLOWED_SIZES.has(raw as SyndicateSize)
    ? (raw as SyndicateSize)
    : DEFAULT_SIZE;
}

function safeSlugify(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 64) || "demo"
  );
}

function titleCase(s: string): string {
  return (
    s
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ""))
      .join(" ") || "Syndicate"
  );
}

/** Merge the canonical store hit with caller-supplied query-param hints. */
function fromStore(syndicate: SyndicateRecord, size: SyndicateSize): RenderArgs {
  return {
    slug: syndicate.slug,
    safeSlug: safeSlugify(syndicate.slug),
    name: syndicate.name,
    ownerHandle: syndicate.owner_handle ?? null,
    memberCount: syndicate.members.length,
    picksMade: syndicate.picks_made,
    tournamentLabel: syndicate.tournament_label,
    size,
  };
}

/** Build a `RenderArgs` from query params alone (store miss fallback). */
function fromQuery(
  req: NextRequest,
  slug: string,
  size: SyndicateSize,
): RenderArgs {
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim() || titleCase(slug);
  const memberCountRaw = url.searchParams.get("member_count");
  const memberCount = Math.max(0, Number(memberCountRaw ?? 0) || 0);
  const tournament =
    (url.searchParams.get("tournament") ?? "").trim() || "World Cup 2026";
  return {
    slug,
    safeSlug: safeSlugify(slug),
    name,
    ownerHandle: null,
    memberCount,
    picksMade: 0,
    tournamentLabel: tournament,
    size,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) {
    return new Response(JSON.stringify({ error: "slug_required" }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  const size = parseSize(req);

  // FAST PATH: serve the disk cache if it exists. The cache is invalidated
  // (deleted) by invalidateSyndicateOgCache on every pool create / branding
  // update / branding upload, so a cache hit means the image is current.
  // First-render-after-save is dynamic (~600ms); every subsequent share-
  // crawler hit is a flat-file read (~3ms).
  const safeSlug = safeSlugify(slug);
  const cached = await readDiskCache(safeSlug, size);
  if (cached) {
    return new Response(cached as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="syndicate-${safeSlug}-${size}.png"`,
        "cache-control": "public, s-maxage=60, stale-while-revalidate=600",
        "x-vtorn-og-size": size,
        "x-vtorn-og-cache": "hit",
      },
    });
  }

  // Resolution order: store lookup -> query-param fallback -> never 404.
  let args: RenderArgs;
  try {
    const syndicate = await loadSyndicateBySlug(slug);
    args = syndicate ? fromStore(syndicate, size) : fromQuery(req, slug, size);
  } catch {
    args = fromQuery(req, slug, size);
  }

  try {
    const png = await renderPNG(args);
    void tryDiskCache(args.safeSlug, args.size, png);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="syndicate-${args.safeSlug}-${args.size}.png"`,
        // Short edge TTL + SWR; the live member count refreshes within
        // ~1 minute once the syndicate lands in the canonical store.
        "cache-control": "public, s-maxage=60, stale-while-revalidate=600",
        "x-vtorn-og-size": args.size,
        "x-vtorn-og-cache": "miss",
      },
    });
  } catch (err) {
    const fallback = renderFallbackPng();
    return new Response(fallback as unknown as BodyInit, {
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

// ─── Render tree ────────────────────────────────────────────────────

async function renderPNG(args: RenderArgs): Promise<Buffer> {
  const { width, height } = SIZES[args.size];
  const fonts = await loadFonts();

  // Per-size typography scale; landscape baseline 1.0, larger formats
  // scale up so the headline still dominates on tall canvases.
  const scale =
    args.size === "landscape" ? 1 : args.size === "square" ? 1.1 : 1.2;
  const padding = args.size === "landscape" ? 72 : 88;

  // Headline auto-shrinks for long pool names so the type doesn't run
  // off the edge of the canvas. ~22 characters fits on the landscape
  // canvas at the base size; longer names step down a tier.
  const nameLen = args.name.length;
  const baseTitle =
    args.size === "landscape" ? 112 : args.size === "square" ? 124 : 132;
  const titleFont = Math.round(
    (nameLen > 26
      ? baseTitle * 0.72
      : nameLen > 18
        ? baseTitle * 0.86
        : baseTitle) * scale,
  );

  const datelineFont = Math.round(24 * scale);
  const statNumFont = Math.round(72 * scale);
  const statLabelFont = Math.round(18 * scale);
  const footerFont = Math.round(22 * scale);

  const url = `play.tournamental.com/s/${args.slug}`;
  const dateline = args.ownerHandle
    ? `FWC2026 · @${args.ownerHandle}`
    : `FWC2026 · ${args.tournamentLabel.toUpperCase()}`;
  const memberLabel = args.memberCount === 1 ? "MEMBER" : "MEMBERS";
  const picksLabel = args.picksMade === 1 ? "PICK MADE" : "PICKS MADE";

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
        // Flat charcoal canvas. No radial, no gradient, no sky-blue.
        background: COLOUR_BG,
        padding,
        color: COLOUR_FG_STRONG,
        fontFamily: "Fraunces",
        position: "relative",
      },
      children: [
        // ─── Top row: gold ball mark + mono dateline.
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
                    // Mono dateline with a leading hairline rule, matches
                    // the BRAND.md "dateline" pattern on the live page.
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

        // ─── Headline: pool name in big Fraunces display.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: Math.round(28 * scale),
              maxWidth: width - padding * 2,
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Fraunces",
                    fontSize: titleFont,
                    fontWeight: 500,
                    letterSpacing: "-0.018em",
                    lineHeight: 0.98,
                    color: COLOUR_FG_STRONG,
                    display: "flex",
                    flexWrap: "wrap",
                  },
                  children: args.name,
                },
              },
              // Competitive-psychology hook (Tim 2026-05-22). Italic
              // Fraunces, ~38% the title size, slightly muted so it
              // reads as a sub-line rather than competing with the
              // pool name. Same line goes into every share-text body.
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Fraunces",
                    fontSize: Math.round(titleFont * 0.34),
                    fontWeight: 500,
                    fontStyle: "italic",
                    letterSpacing: "0.005em",
                    lineHeight: 1.25,
                    color: COLOUR_FG_STRONG,
                    opacity: 0.88,
                    display: "flex",
                    flexWrap: "wrap",
                    maxWidth: width - padding * 2,
                  },
                  children:
                    "Do you think you can predict the outcome of the FIFA World Cup better than I can?",
                },
              },
            ],
          },
        },

        // ─── Bottom: stat row + footer URL.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: Math.round(28 * scale),
            },
            children: [
              // Hairline rule above the stats.
              {
                type: "div",
                props: {
                  style: {
                    width: "100%",
                    height: 1,
                    background: COLOUR_GOLD_DEEP,
                    opacity: 0.55,
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: Math.round(48 * scale),
                  },
                  children: [
                    renderStatCell({
                      num: formatCount(args.memberCount),
                      label: memberLabel,
                      statNumFont,
                      statLabelFont,
                    }),
                    renderStatCell({
                      num: formatCount(args.picksMade),
                      label: picksLabel,
                      statNumFont,
                      statLabelFont,
                    }),
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "DejaVuMono",
                          fontSize: footerFont,
                          color: COLOUR_GOLD,
                          letterSpacing: "0.04em",
                          textAlign: "right",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "flex-end",
                        },
                        children: url,
                      },
                    },
                  ],
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
      width,
      height,
      fonts: [
        {
          name: "Fraunces",
          data: fonts.fraunces500,
          weight: 500,
          style: "normal",
        },
        {
          name: "Fraunces",
          data: fonts.fraunces700,
          weight: 700,
          style: "normal",
        },
        {
          name: "Fraunces",
          data: fonts.frauncesItalic500,
          weight: 500,
          style: "italic",
        },
        {
          name: "DejaVuMono",
          data: fonts.mono,
          weight: 400,
          style: "normal",
        },
        {
          name: "DejaVuMono",
          data: fonts.mono,
          weight: 600,
          style: "normal",
        },
      ],
    },
  );
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Inline SVG of the gold soccer-ball mark: a gold-filled circle with
 * three lattice pentagons (faint) embossed on the surface, ringed in
 * a deeper gold to give it a stamped-coin feel against the charcoal
 * canvas. Pure SVG so we don't have to fetch a raster on every render.
 */
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
      <!-- Centre pentagon. -->
      <polygon points="50,30 65,42 60,60 40,60 35,42" fill="#15151a" opacity="0.55" />
      <!-- Three peripheral pentagons (just visual rhythm). -->
      <polygon points="20,38 33,32 38,44 28,52 18,46" fill="#15151a" opacity="0.32" />
      <polygon points="82,38 87,46 78,52 68,44 73,32" fill="#15151a" opacity="0.32" />
      <polygon points="50,72 60,80 50,90 40,80" fill="#15151a" opacity="0.32" />
      <!-- Connecting strokes for the lattice impression. -->
      <line x1="50" y1="30" x2="50" y2="14" stroke="#6b4708" stroke-width="1.5" opacity="0.6" />
      <line x1="35" y1="42" x2="20" y2="38" stroke="#6b4708" stroke-width="1.5" opacity="0.6" />
      <line x1="65" y1="42" x2="82" y2="38" stroke="#6b4708" stroke-width="1.5" opacity="0.6" />
      <line x1="40" y1="60" x2="40" y2="80" stroke="#6b4708" stroke-width="1.5" opacity="0.6" />
      <line x1="60" y1="60" x2="60" y2="80" stroke="#6b4708" stroke-width="1.5" opacity="0.6" />
    </svg>
  `;
  return {
    type: "img",
    props: {
      width: size,
      height: size,
      src: `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`,
      style: {
        width: size,
        height: size,
        borderRadius: "50%",
      },
    },
  };
}

interface StatCellArgs {
  readonly num: string;
  readonly label: string;
  readonly statNumFont: number;
  readonly statLabelFont: number;
}

function renderStatCell({
  num,
  label,
  statNumFont,
  statLabelFont,
}: StatCellArgs): unknown {
  return {
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
              fontSize: statNumFont,
              fontWeight: 500,
              color: COLOUR_GOLD,
              lineHeight: 0.95,
              fontFeatureSettings: '"tnum" 1, "lnum" 1',
              letterSpacing: "-0.01em",
            },
            children: num,
          },
        },
        {
          type: "div",
          props: {
            style: {
              fontFamily: "DejaVuMono",
              fontSize: statLabelFont,
              color: COLOUR_FG_MUTED,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 500,
            },
            children: label,
          },
        },
      ],
    },
  };
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

const OG_CACHE_DIR = join(process.cwd(), "public", "og", "syndicate");

async function tryDiskCache(
  safeSlug: string,
  size: SyndicateSize,
  png: Buffer,
): Promise<string | null> {
  const file = join(OG_CACHE_DIR, `${safeSlug}-${size}.png`);
  try {
    await fs.mkdir(OG_CACHE_DIR, { recursive: true });
    await fs.writeFile(file, png);
    return file;
  } catch {
    return null;
  }
}

async function readDiskCache(
  safeSlug: string,
  size: SyndicateSize,
): Promise<Buffer | null> {
  const file = join(OG_CACHE_DIR, `${safeSlug}-${size}.png`);
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

/**
 * Delete every cached OG variant for a pool slug. Call this from any
 * write path that changes the rendered output (pool create, branding
 * patch, branding image upload) so the next share-crawler hit re-
 * renders against the fresh data. Best-effort; failures are silent
 * because the cache is a perf optimisation, not a correctness guarantee.
 */
export async function invalidateSyndicateOgCache(slug: string): Promise<void> {
  const safeSlug = safeSlugify(slug);
  await Promise.allSettled(
    Array.from(ALLOWED_SIZES).map((size) =>
      fs.rm(join(OG_CACHE_DIR, `${safeSlug}-${size}.png`), { force: true }),
    ),
  );
}

function renderFallbackPng(): Buffer {
  // 1x1 transparent PNG. Used when satori can't find a font in dev. The
  // route stays 200 because Open Graph crawlers downgrade gracelessly
  // on 5xx and we'd rather ship a tiny image than block the share link
  // rendering.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
}
