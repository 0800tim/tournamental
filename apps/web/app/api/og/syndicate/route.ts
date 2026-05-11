/**
 * /api/og/syndicate — OG image generator for syndicate share pages.
 *
 * Surfaces the syndicate identity (name, host, member count, picks
 * made) as a 3-size matrix to match `/api/og/bracket`:
 *
 *   - landscape (default) → 1200×630  — X / FB / LinkedIn / Telegram.
 *   - portrait            → 1080×1350 — Instagram feed / Facebook / generic.
 *   - square              → 1080×1080 — Instagram square / Slack / WhatsApp.
 *
 * Query params (all optional except `slug`):
 *   - slug          (required) — the syndicate slug. We do a server-side
 *                                lookup so the rendered image reflects
 *                                the LIVE member count and picks-made
 *                                figure when the syndicate is in the
 *                                store.
 *   - name          (optional) — display name override / fallback when
 *                                the syndicate isn't in the store yet.
 *   - member_count  (optional) — integer ≥ 0; fallback for store miss.
 *   - tournament    (optional) — defaults to "FIFA WC 2026".
 *   - size          (optional) — landscape | portrait | square.
 *
 * Resolution order:
 *   1. `loadSyndicateBySlug(slug)` — the canonical store, when populated.
 *   2. Inline query-param hints — when the slug isn't in the store yet
 *      but the caller has the metadata. This keeps the route useful for
 *      previews and lets newly-signed-up syndicates render an OG card
 *      before the backend hydrates.
 *   3. A title-cased slug + zero members — last-resort placeholder so
 *      the route NEVER 404s. A poisoned 4xx in the CDN ruins every
 *      Open-Graph unfurl until the cache evicts.
 *
 * Caching:
 *   - On-disk PNG at `apps/web/public/og/syndicate/<slug>-<size>.png` so
 *     the second request hits the static-asset handler.
 *   - HTTP: short edge TTL + SWR so a live member count refreshes
 *     within ~1 minute. (When the syndicate is in the store, freshness
 *     matters more than the immutability optimisation the bracket OG
 *     uses.)
 *
 * Rendering: satori (JSX→SVG) + @resvg/resvg-js (SVG→PNG). The DejaVu
 * font buffer is cached in module scope so the hot path stays cheap.
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

// Module-scope font cache — satori needs the buffer on every render but
// we only read it from disk once per process.
let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontCache) return fontCache;
  const regularCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  const boldCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
  ];
  const regular = await readFirst(regularCandidates);
  const bold = await readFirst(boldCandidates);
  fontCache = { regular, bold };
  return fontCache;
}

async function readFirst(paths: readonly string[]): Promise<ArrayBuffer> {
  for (const p of paths) {
    try {
      const data = await fs.readFile(p);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    } catch {
      // try next
    }
  }
  throw new Error("no system font available for satori; vendor a TTF in apps/web/public/fonts/");
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
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 64) || "demo";
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
function fromQuery(req: NextRequest, slug: string, size: SyndicateSize): RenderArgs {
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim() || titleCase(slug);
  const memberCountRaw = url.searchParams.get("member_count");
  const memberCount = Math.max(0, Number(memberCountRaw ?? 0) || 0);
  const tournament = (url.searchParams.get("tournament") ?? "").trim() || "FIFA WC 2026";
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

  const size = parseSize(req);

  // Resolution order: store lookup → query-param fallback → never 404.
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
        // Short edge TTL + SWR — the live member count refreshes within
        // ~1 minute once the syndicate lands in the canonical store.
        "cache-control": "public, s-maxage=60, stale-while-revalidate=600",
        "x-vtorn-og-size": args.size,
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
        "x-og-error": err instanceof Error ? err.message.slice(0, 200) : "render_failed",
      },
    });
  }
}

async function renderPNG(args: RenderArgs): Promise<Buffer> {
  const { width, height } = SIZES[args.size];
  const fonts = await loadFonts();

  // Per-size typography scale — keeps the wordmark / title hierarchy
  // legible at every aspect ratio without overflowing on portrait.
  const scale =
    args.size === "landscape" ? 1 : args.size === "square" ? 1.05 : 1.15;
  const padding = args.size === "landscape" ? 64 : 80;
  const titleFont = Math.round(70 * scale);
  const memberFont = Math.round(36 * scale);
  const handleFont = Math.round(26 * scale);
  const footerFont = Math.round(24 * scale);
  const wordmarkFont = Math.round(28 * scale);

  const url = `play.tournamental.com/s/${args.slug}`;
  const memberWord = args.memberCount === 1 ? "member" : "members";
  const memberChipText = `${formatCount(args.memberCount)} ${memberWord}`;
  const subline = args.picksMade > 0
    ? `${formatCount(args.picksMade)} ${args.picksMade === 1 ? "pick" : "picks"} made · ${args.tournamentLabel}`
    : `predicting ${args.tournamentLabel}`;
  const hostedLine = args.ownerHandle ? `hosted by @${args.ownerHandle}` : null;

  const tree = {
    type: "div",
    props: {
      style: {
        width,
        height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        // Tournamental brand: deep navy + warm gold radial.
        background:
          "radial-gradient(120% 90% at 78% 35%, rgba(245,197,66,0.32) 0%, rgba(245,197,66,0.08) 38%, rgba(10,14,26,0) 70%), linear-gradient(135deg, #0a0e1a 0%, #101626 60%, #1a1f3a 100%)",
        padding,
        color: "#ffffff",
        fontFamily: "DejaVu",
      },
      children: [
        // ─── Header: T-mark + wordmark on the left, SYNDICATE label on right.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: 16 },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          width: Math.round(48 * scale),
                          height: Math.round(48 * scale),
                          borderRadius: 10,
                          background: "#f5c542",
                          color: "#0a0e1a",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: Math.round(34 * scale),
                          fontWeight: 900,
                        },
                        children: "T",
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: wordmarkFont,
                          fontWeight: 700,
                          letterSpacing: "-0.02em",
                        },
                        children: "Tournamental",
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: handleFont,
                    color: "#cdd5e7",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  },
                  children: "SYNDICATE",
                },
              },
            ],
          },
        },

        // ─── Centre block: name + (host) + members chip + subline.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 18,
              maxWidth: width - padding * 2,
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: titleFont,
                    fontWeight: 900,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.05,
                  },
                  children: args.name,
                },
              },
              ...(hostedLine
                ? [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontSize: Math.round(memberFont * 0.78),
                          color: "#cdd5e7",
                          fontWeight: 400,
                        },
                        children: hostedLine,
                      },
                    },
                  ]
                : []),
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    fontSize: memberFont,
                    color: "#cdd5e7",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          background: "rgba(245,197,66,0.18)",
                          color: "#f5c542",
                          padding: `${Math.round(8 * scale)}px ${Math.round(20 * scale)}px`,
                          borderRadius: 999,
                          fontSize: Math.round(memberFont * 0.85),
                          fontWeight: 700,
                          letterSpacing: "0.02em",
                        },
                        children: memberChipText,
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { color: "#9aa3b8" },
                        children: subline,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },

        // ─── Footer: Join URL on the left, FREE TO PLAY on the right.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid rgba(255,255,255,0.12)",
              paddingTop: Math.round(24 * scale),
              fontSize: footerFont,
              color: "#cdd5e7",
              width: "100%",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "baseline", gap: 12 },
                  children: [
                    {
                      type: "div",
                      props: { children: "Join at" },
                    },
                    {
                      type: "div",
                      props: {
                        style: { color: "#f5c542", fontWeight: 700 },
                        children: url,
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: footerFont,
                    color: "#9aa3b8",
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                  },
                  children: "FREE TO PLAY",
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
      { name: "DejaVu", data: fonts.regular, weight: 400, style: "normal" },
      { name: "DejaVu", data: fonts.bold, weight: 700, style: "normal" },
      { name: "DejaVu", data: fonts.bold, weight: 900, style: "normal" },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return Buffer.from(png);
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

async function tryDiskCache(
  safeSlug: string,
  size: SyndicateSize,
  png: Buffer,
): Promise<string | null> {
  const dir = join(process.cwd(), "public", "og", "syndicate");
  const file = join(dir, `${safeSlug}-${size}.png`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, png);
    return file;
  } catch {
    return null;
  }
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
