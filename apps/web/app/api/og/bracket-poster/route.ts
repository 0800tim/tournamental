/**
 * /api/og/bracket-poster, the printable bracket poster.
 *
 * Light-theme A3-print-quality (2400×3600 portrait, ~200dpi) PNG of
 * the user's full 104-pick bracket. Designed for download + print +
 * wall display. Tim 2026-06-01.
 *
 * Derived from /api/og/bracket-birdseye (which is the 1080×1920
 * dark-theme social-share variant). The poster swaps:
 *   - palette: cream paper + dark navy + muted gold + FIFA-magenta accent
 *   - size: 2400×3600 portrait by default (A3 @ ~200dpi)
 *   - title: FIFA WC26 + host-nation dateline instead of "My World Cup"
 *   - cache: long edge TTL (1h) + immutable, since user content is
 *     keyed by bracket_id and only changes on bracket save.
 *
 * Original birdseye docstring:
 *
 * Renders the entire 48-team Football World Cup 2026 surface in one
 * frame: 12 group cards (flag emojis + ABBR) above a knockout
 * cascade that traces the user's gold-path (R16 → QF → SF → Final →
 * Champion). Shareable as a single PNG to WhatsApp / Insta / X /
 * Telegram as the "this is my whole bracket" brag (Tim 2026-05-22,
 * doc 36 §F item 11).
 *
 * Sizes:
 *   - portrait (1080×1920) - STORY-shaped, the default for share menus.
 *   - landscape (1200×630) - X / FB / Telegram unfurl.
 *   - square (1080×1080)   - Insta square / Slack / WhatsApp thumb.
 *
 * Query params (all optional, render-safe placeholders if absent):
 *   - bracket_id (preferred), the user's share guid; if present we
 *     fetch /v1/bracket/by-guid/<id> from the game service to resolve
 *     champion + runner-up + third + knockout_path.
 *   - champion, runner_up, third - 3-letter codes (fallback when no id).
 *   - ko - pipe-delimited path "r16:MEX|qf:BRA|sf:GER|final:FRA" of the
 *     opponents the user predicted to beat at each stage.
 *   - handle - the predictor's display handle (shown in the dateline).
 *   - tournament - defaults to "FWC2026".
 *   - size - portrait | landscape | square.
 *
 * Rendering: satori (JSX → SVG) + @resvg/resvg-js (SVG → PNG). Fonts
 * (Fraunces + DejaVu mono fallback for the flag emojis and dateline)
 * are cached in module scope. Caching: short edge TTL + SWR so a
 * re-saved bracket refreshes within ~1 minute.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { resolveShareGuid } from "@/lib/share/resolve-guid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Size = "portrait" | "landscape" | "square";

const SIZES: Readonly<Record<Size, { width: number; height: number }>> = {
  portrait: { width: 2400, height: 3600 }, // A3 @ ~200dpi, print-quality
  landscape: { width: 3600, height: 2400 }, // A3 landscape
  square: { width: 2400, height: 2400 }, // square print
};

// Light-theme palette for the printable poster. FIFA WC26 official
// colour palette is purple + magenta + neon green; we use a muted
// cream background + dark navy text for a poster that prints crisp on
// A3 and reads well from across a room. The FIFA accent (a muted
// magenta) is used sparingly on the title + Champion border.
const COLOUR_BG = "#faf6ec";          // warm cream paper background
const COLOUR_FG_STRONG = "#0f172a";   // dark navy text
const COLOUR_FG_MUTED = "#6b7280";    // muted grey for 3rd/4th rows
const COLOUR_GOLD = "#a87c14";        // deep muted gold for "GROUP A" labels
const COLOUR_GOLD_BRIGHT = "#c89a2a"; // brighter gold for Champion glyph
const COLOUR_GOLD_DEEP = "#7a5808";   // deepest gold for rank numerals
const COLOUR_BORDER = "rgba(168, 124, 20, 0.22)";
const COLOUR_BORDER_STRONG = "rgba(168, 124, 20, 0.58)";
const COLOUR_CHIP_BG = "rgba(255, 250, 235, 0.65)";
const COLOUR_FIFA_ACCENT = "#c04668"; // FIFA 26 magenta, used on title/Champion only

const GAME_BASE =
  process.env.VTORN_GAME_URL ??
  process.env.NEXT_PUBLIC_VTORN_GAME_URL ??
  "https://game.tournamental.com";

const FETCH_TIMEOUT_MS = 750;

/** Canonical 2026 World Cup group layout, derived once from the
 * fixtures file at module load and cached. Keeps the OG render hot
 * path off the disk. */
const GROUPS: Readonly<Record<string, readonly string[]>> = {
  A: ["MEX", "RSA", "KOR", "CZE"],
  B: ["CAN", "QAT", "BIH", "SUI"],
  C: ["BRA", "HAI", "SCO", "MAR"],
  D: ["USA", "AUS", "PAR", "TUR"],
  E: ["GER", "ECU", "CIV", "CUW"],
  F: ["JPN", "TUN", "NED", "SWE"],
  G: ["BEL", "EGY", "IRN", "NZL"],
  H: ["ESP", "URU", "KSA", "CPV"],
  I: ["FRA", "SEN", "IRQ", "NOR"],
  J: ["ARG", "ALG", "JOR", "AUT"],
  K: ["POR", "COL", "UZB", "COD"],
  L: ["ENG", "GHA", "CRO", "PAN"],
};

interface FontBundle {
  readonly fraunces500: ArrayBuffer;
  readonly fraunces700: ArrayBuffer;
  readonly mono: ArrayBuffer;
  readonly emoji: ArrayBuffer | null;
}
let fontCache: FontBundle | null = null;

async function loadFonts(): Promise<FontBundle> {
  if (fontCache) return fontCache;
  const fontDir = join(process.cwd(), "public", "fonts");
  const monoCandidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  const emojiCandidates = [
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/usr/share/fonts/truetype/noto-emoji/NotoColorEmoji.ttf",
  ];
  const [fraunces500, fraunces700, mono, emoji] = await Promise.all([
    readBuffer(join(fontDir, "Fraunces-500.ttf")),
    readBuffer(join(fontDir, "Fraunces-700.ttf")),
    readFirst(monoCandidates),
    readFirstOptional(emojiCandidates),
  ]);
  fontCache = { fraunces500, fraunces700, mono, emoji };
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

async function readFirstOptional(
  paths: readonly string[],
): Promise<ArrayBuffer | null> {
  for (const p of paths) {
    try {
      return await readBuffer(p);
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Flag SVG cache. Each entry is a base64-encoded `data:image/svg+xml`
 * URI safe to drop into a `backgroundImage: url(...)` declaration on
 * the satori-side render. Populated lazily by `loadFlagDataUris()`.
 * The cache key is the upper-case ISO team code (e.g. "ARG"). A miss
 * (e.g. unknown code, file not on disk) returns null which the
 * renderer treats as "no flag, fall back to the plain charcoal
 * circle". Tim 2026-05-22. */
const flagCache = new Map<string, string | null>();

async function loadFlagDataUri(code: string): Promise<string | null> {
  if (flagCache.has(code)) return flagCache.get(code) ?? null;
  const path = join(process.cwd(), "public", "flags", `${code}.svg`);
  try {
    const data = await fs.readFile(path);
    const b64 = data.toString("base64");
    const uri = `data:image/svg+xml;base64,${b64}`;
    flagCache.set(code, uri);
    return uri;
  } catch {
    flagCache.set(code, null);
    return null;
  }
}

async function loadFlagDataUris(codes: readonly string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  await Promise.all(unique.map(loadFlagDataUri));
  const out = new Map<string, string>();
  for (const c of unique) {
    const v = flagCache.get(c);
    if (v) out.set(c, v);
  }
  return out;
}

interface KoPick {
  stage: "r32" | "r16" | "qf" | "sf" | "final" | "tp";
  opponent: string;
}

interface RenderArgs {
  readonly champion: string | null;
  readonly runnerUp: string | null;
  readonly third: string | null;
  readonly ko: readonly KoPick[];
  readonly handle: string;
  readonly tournament: string;
  readonly size: Size;
}

function isoCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(s) ? s : null;
}

function parseKoParam(raw: string | null): KoPick[] {
  if (!raw) return [];
  return raw
    .split(/[|,]/)
    .map((seg) => {
      const [stage, code] = seg.split(":");
      const s = (stage ?? "").toLowerCase();
      const c = isoCode(code ?? null);
      if (!c) return null;
      if (!["r32", "r16", "qf", "sf", "final", "tp"].includes(s)) return null;
      return { stage: s as KoPick["stage"], opponent: c };
    })
    .filter((x): x is KoPick => x !== null);
}

function parseSize(req: NextRequest): Size {
  const raw = new URL(req.url).searchParams.get("size");
  if (raw === "landscape" || raw === "square") return raw;
  return "portrait";
}

function parseArgs(req: NextRequest, size: Size): RenderArgs {
  const url = new URL(req.url);
  const handle =
    (url.searchParams.get("handle") ?? "").trim().slice(0, 24) || "Predictor";
  const tournament =
    (url.searchParams.get("tournament") ?? "FWC2026").trim().slice(0, 16).toUpperCase() ||
    "FWC2026";
  return {
    champion: isoCode(url.searchParams.get("champion")),
    runnerUp: isoCode(url.searchParams.get("runner_up")),
    third: isoCode(url.searchParams.get("third")),
    ko: parseKoParam(url.searchParams.get("ko")),
    handle,
    tournament,
    size,
  };
}

async function enrichFromGameService(
  bracketId: string,
  inline: RenderArgs,
): Promise<RenderArgs> {
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(bracketId)) return inline;
  // Use the same share-guid resolver the /s/[guid] page uses so the OG
  // endpoint accepts a friendly handle ("0800tim"), a raw share guid
  // (UUID / nanoid / `u_<hex>`), or a syndicate slug. The previous
  // hand-rolled fetch only handled raw share guids, so anyone calling
  // ?bracket_id=<handle> got an empty card. Tim 2026-05-25.
  try {
    const resolved = await resolveShareGuid(bracketId);
    if (resolved.kind !== "user") return inline;
    const b = resolved.bracket as unknown as Record<string, unknown>;
    const championCode = isoCode(
      (b.champion as { code?: string } | undefined)?.code ??
        (b.champion_code as string | undefined),
    );
    const runnerUpCode = isoCode(
      (b.runner_up as { code?: string } | undefined)?.code ??
        (b.runner_up_code as string | undefined),
    );
    const thirdCode = isoCode(
      (b.third_place as { code?: string } | undefined)?.code ??
        (b.third_place_code as string | undefined),
    );
    const champion = inline.champion ?? championCode;
    const runnerUp = inline.runnerUp ?? runnerUpCode;
    const third = inline.third ?? thirdCode;
    let ko = inline.ko;
    if (ko.length === 0 && Array.isArray(b.path_to_gold)) {
      // Newer schema: path_to_gold = [{stage, opponent: {code, name, ...}}, ...]
      ko = (b.path_to_gold as unknown[])
        .map((e) => {
          if (!e || typeof e !== "object") return null;
          const r = e as Record<string, unknown>;
          const stage = typeof r.stage === "string" ? r.stage.toLowerCase() : null;
          const oppObj = r.opponent as { code?: string } | undefined;
          const opp =
            isoCode(oppObj?.code) ?? isoCode(r.opponent_code as string | undefined);
          if (!stage || !opp) return null;
          if (!["r32", "r16", "qf", "sf", "final", "tp"].includes(stage)) return null;
          return { stage: stage as KoPick["stage"], opponent: opp };
        })
        .filter((x): x is KoPick => x !== null);
    }
    if (ko.length === 0 && Array.isArray(b.knockout_path)) {
      // Legacy schema fallback.
      ko = (b.knockout_path as unknown[])
        .map((e) => {
          if (!e || typeof e !== "object") return null;
          const r = e as Record<string, unknown>;
          const stage = typeof r.stage === "string" ? r.stage.toLowerCase() : null;
          const opp = isoCode(r.opponent_code as string | undefined);
          if (!stage || !opp) return null;
          if (!["r32", "r16", "qf", "sf", "final", "tp"].includes(stage)) return null;
          return { stage: stage as KoPick["stage"], opponent: opp };
        })
        .filter((x): x is KoPick => x !== null);
    }
    return { ...inline, champion, runnerUp, third, ko };
  } catch {
    return inline;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const size = parseSize(req);
  let args = parseArgs(req, size);
  const bracketId = (new URL(req.url).searchParams.get("bracket_id") ?? "").trim();
  if (bracketId) args = await enrichFromGameService(bracketId, args);

  try {
    const png = await renderPNG(args);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="birdseye-${args.size}.png"`,
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400, immutable",
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

// ─── Render ─────────────────────────────────────────────────────────

async function renderPNG(args: RenderArgs): Promise<Buffer> {
  const { width, height } = SIZES[args.size];
  const fonts = await loadFonts();
  // Preload flag SVGs for every team referenced anywhere on the card:
  // all 48 group-stage teams (so each group card can paint flag cells)
  // + the KO opponents at each stage + the champion / runner-up /
  // third-place picks for the podium. Tim 2026-05-22, expanded
  // 2026-05-25 to cover the 48 group flags too -- previously the
  // group section showed only 3-letter codes which read as
  // unbranded text on social shares.
  const flagCodes: string[] = [];
  for (const codes of Object.values(GROUPS)) for (const c of codes) flagCodes.push(c);
  for (const p of args.ko) flagCodes.push(p.opponent);
  if (args.champion) flagCodes.push(args.champion);
  if (args.runnerUp) flagCodes.push(args.runnerUp);
  if (args.third) flagCodes.push(args.third);
  const flagsByCode = await loadFlagDataUris(flagCodes);
  const iconMarkUri = await loadIconMark();
  const isPortrait = args.size === "portrait";
  const isLandscape = args.size === "landscape";

  // Per-size paddings + scale.
  const padding = isPortrait ? 124 : isLandscape ? 96 : 110; // generous margin for print
  const scale = isPortrait ? 2.22 : isLandscape ? 2.0 : 2.0; // 2.22x = 2400/1080 for the print-poster portrait

  // KO stage picks indexed by stage.
  const koByStage = new Map(args.ko.map((p) => [p.stage, p.opponent] as const));

  const datelineFont = Math.round(22 * scale);
  const titleFont = Math.round(72 * scale); // bigger headline for print poster
  const handleFont = Math.round(32 * scale);
  const groupLetterFont = Math.round(22 * scale);
  const groupCodeFont = Math.round(22 * scale);
  const groupFlagFont = Math.round(28 * scale);
  const stageLabelFont = Math.round(16 * scale);
  const koCodeFont = Math.round(40 * scale);
  const koFlagFont = Math.round(34 * scale);
  const championFont = Math.round(100 * scale); // dampened from 148 to keep champion contained in print layout
  const ballSize = Math.round(96 * scale);

  const dateline = `11 JUN - 19 JUL 2026 · USA · MEXICO · CANADA · @${args.handle.toUpperCase()}`;

  // Groups grid: 4 columns x 3 rows on portrait/square, 6x2 on landscape.
  const groupCols = isLandscape ? 6 : 4;
  const groupGap = Math.round(10 * scale);
  const groupEntries = Object.entries(GROUPS) as ReadonlyArray<[string, readonly string[]]>;

  const tree = {
    type: "div",
    props: {
      style: {
        width,
        height,
        display: "flex",
        flexDirection: "column",
        background: COLOUR_BG,
        padding,
        color: COLOUR_FG_STRONG,
        fontFamily: "Fraunces",
        position: "relative",
        gap: Math.round(24 * scale),
      },
      children: [
        // ─── Header: gold ball + dateline + headline + handle.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: Math.round(10 * scale),
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: Math.round(20 * scale),
                  },
                  children: [
                    renderGoldBall(ballSize, iconMarkUri),
                    {
                      type: "div",
                      props: {
                        style: {
                          display: "flex",
                          alignItems: "center",
                          gap: "0.7em",
                          fontFamily: "DejaVuMono",
                          fontSize: datelineFont,
                          color: COLOUR_GOLD,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          fontWeight: 500,
                        },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: {
                                width: Math.round(36 * scale),
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
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Fraunces",
                    fontSize: titleFont,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    color: COLOUR_FG_STRONG,
                    lineHeight: 1.05,
                  },
                  children: "FIFA WORLD CUP 26™",
                },
              },
              // Dynamic subtitle: names the predicted champion so the
              // share image telegraphs the call in a single glance
              // even when the receiver only sees the top third of the
              // image in their preview pane (Tim 2026-05-26).
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Fraunces",
                    fontSize: Math.round(titleFont * 0.42),
                    fontWeight: 500,
                    fontStyle: "italic",
                    letterSpacing: "0.01em",
                    color: COLOUR_FG_MUTED,
                    lineHeight: 1.2,
                    marginTop: Math.round(2 * scale),
                  },
                  children: args.champion
                    ? `${args.champion} to lift the trophy.`
                    : "48 teams. 104 matches. One predicted champion.",
                },
              },
            ],
          },
        },

        // ─── 12 group cards. satori doesn't support CSS grid, so we
        // emulate with a wrapping flex row + explicit per-cell width.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexWrap: "wrap",
              gap: groupGap,
            },
            children: groupEntries.map(([letter, codes]) =>
              renderGroupCard({
                letter,
                codes,
                letterFont: groupLetterFont,
                codeFont: groupCodeFont,
                flagFont: groupFlagFont,
                scale,
                widthPct: 100 / groupCols,
                gap: groupGap,
                cols: groupCols,
                flagsByCode,
              }),
            ),
          },
        },

        // ─── Knockout cascade + champion. The cascade group takes
        // whatever vertical space is left after header + groups +
        // footer; inside, both the KO ladder and the champion panel
        // size to their own content and align tight to the top. The
        // earlier "flex: 1 1 auto" on the KO ladder itself stretched
        // it vertically and left a huge gap above the champion (Tim
        // 2026-05-25).
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: isLandscape ? "row" : "column",
              alignItems: "stretch",
              justifyContent: "flex-start",
              gap: Math.round(18 * scale),
              flex: "0 0 auto",
            },
            children: [
              // KO ladder
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: Math.round(10 * scale),
                    padding: Math.round(22 * scale),
                    background: "rgba(255, 255, 255, 0.02)",
                    border: `1px solid ${COLOUR_BORDER}`,
                    borderRadius: Math.round(14 * scale),
                    flex: "0 0 auto",
                  },
                  children: renderKoLadder({
                    koByStage,
                    champion: args.champion,
                    runnerUp: args.runnerUp,
                    stageLabelFont,
                    codeFont: koCodeFont,
                    flagFont: koFlagFont,
                    scale,
                    flagsByCode,
                  }),
                },
              },
              // Champion crown panel
              renderChampionPanel({
                champion: args.champion,
                runnerUp: args.runnerUp,
                third: args.third,
                font: championFont,
                stageLabelFont,
                scale,
                flagsByCode,
              }),
            ],
          },
        },

        // Footer with a faint gold rule above to anchor it visually
        // against the dense panels above (Tim 2026-05-26).
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: Math.round(14 * scale),
              marginTop: Math.round(24 * scale),
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: "100%",
                    height: 1,
                    background: COLOUR_BORDER,
                  },
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontFamily: "DejaVuMono",
                    fontSize: Math.round(18 * scale),
                    color: COLOUR_FG_MUTED,
                    letterSpacing: "0.08em",
                  },
                  children: [
                    "play.tournamental.com",
                    {
                      type: "div",
                      props: {
                        style: { color: COLOUR_GOLD, fontWeight: 700 },
                        children: "BUILD YOURS →",
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

  const fontList: Array<{ name: string; data: ArrayBuffer; weight?: 400 | 500 | 700; style?: "normal" | "italic" }> = [
    { name: "Fraunces", data: fonts.fraunces500, weight: 500, style: "normal" },
    { name: "Fraunces", data: fonts.fraunces700, weight: 700, style: "normal" },
    { name: "DejaVuMono", data: fonts.mono, weight: 400, style: "normal" },
    { name: "DejaVuMono", data: fonts.mono, weight: 500, style: "normal" },
  ];

  const svg = await satori(
    tree as unknown as Parameters<typeof satori>[0],
    {
      width,
      height,
      fonts: fontList,
    },
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } })
    .render()
    .asPng();
  return Buffer.from(png);
}

// ─── Pieces ────────────────────────────────────────────────────────

function renderGroupCard(args: {
  letter: string;
  codes: readonly string[];
  letterFont: number;
  codeFont: number;
  flagFont: number;
  scale: number;
  widthPct: number;
  gap: number;
  cols: number;
  flagsByCode: Map<string, string>;
}): unknown {
  // Compute pixel-width approximation for flex item. satori's flexbox
  // engine handles `width: <pct>` by referencing the parent's content
  // box, so we shrink each cell to fit cols + (cols-1) gap segments.
  const gapAllowance = args.gap * (args.cols - 1);
  // Small flag chips sized slightly larger than code-font cap height
  // so the colour of each country reads at a glance even in the
  // 12-card birdseye view (Tim 2026-05-26).
  const flagDiameter = Math.round(args.codeFont * 1.18);
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: Math.round(6 * args.scale),
        padding: Math.round(12 * args.scale),
        background: COLOUR_CHIP_BG,
        border: `1px solid ${COLOUR_BORDER}`,
        borderRadius: Math.round(10 * args.scale),
        // Flex-basis with gap subtracted so cols fit exactly.
        width: `calc(${args.widthPct}% - ${Math.round(gapAllowance / args.cols)}px)`,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              fontFamily: "DejaVuMono",
              fontSize: args.letterFont,
              color: COLOUR_GOLD,
              fontWeight: 700,
              letterSpacing: "0.14em",
            },
            children: `GROUP ${args.letter}`,
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: Math.round(4 * args.scale),
            },
            children: args.codes.map((code, idx) => {
              const flag = args.flagsByCode.get(code) ?? null;
              const flagChild: Record<string, unknown> = {
                display: "flex",
                width: flagDiameter,
                height: flagDiameter,
                borderRadius: "50%",
                border: `1px solid ${COLOUR_BORDER}`,
                overflow: "hidden",
                flexShrink: 0,
              };
              if (flag) {
                flagChild.backgroundImage = `url("${flag}")`;
                flagChild.backgroundSize = "cover";
                flagChild.backgroundPosition = "center";
              } else {
                flagChild.background = "rgba(168, 124, 20, 0.10)"; // light cream chip for missing flag
              }
              return {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: Math.round(8 * args.scale),
                    fontFamily: "Fraunces",
                    fontSize: args.codeFont,
                    color: idx < 2 ? COLOUR_FG_STRONG : COLOUR_FG_MUTED,
                    fontWeight: idx < 2 ? 700 : 500,
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "DejaVuMono",
                          fontSize: Math.round(args.codeFont * 0.55),
                          color: COLOUR_GOLD_DEEP,
                          width: Math.round(14 * args.scale),
                        },
                        children: String(idx + 1),
                      },
                    },
                    { type: "div", props: { style: flagChild, children: "" } },
                    code,
                  ],
                },
              };
            }),
          },
        },
      ],
    },
  };
}

function renderKoLadder(args: {
  koByStage: Map<KoPick["stage"], string>;
  champion: string | null;
  runnerUp: string | null;
  stageLabelFont: number;
  codeFont: number;
  flagFont: number;
  scale: number;
  flagsByCode: Map<string, string>;
}): unknown[] {
  const stages: Array<{ key: KoPick["stage"]; label: string }> = [
    { key: "r32", label: "R32" },
    { key: "r16", label: "R16" },
    { key: "qf", label: "QF" },
    { key: "sf", label: "SF" },
    { key: "final", label: "FINAL" },
  ];
  // Bumped 2026-05-25: previous 86px circles read very small at
  // portrait scale; the share card needs each opponent's flag legible
  // at a glance on a phone share preview.
  const circleSize = Math.round(132 * args.scale);

  // Render cells interleaved with thin gold chevron separators so the
  // ladder reads left-to-right as a progression (Tim 2026-05-26).
  // Earlier version used a per-cell "BEAT" caption - redundant on a
  // share card where each row already implies progression.
  const out: unknown[] = [];
  stages.forEach((s, idx) => {
    if (idx > 0) {
      out.push({
        type: "div",
        props: {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "Fraunces",
            fontSize: Math.round(56 * args.scale),
            color: COLOUR_GOLD,
            // Lift the chevron so it sits visually mid-circle, not
            // mid-label-block.
            marginTop: Math.round(args.stageLabelFont * 1.4),
            fontWeight: 500,
            flex: "0 0 auto",
            opacity: 0.95,
          },
          children: "›",
        },
      });
    }
    const opponent = args.koByStage.get(s.key) ?? " - ";
    const flag = opponent === " - " ? null : args.flagsByCode.get(opponent) ?? null;
    out.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: Math.round(8 * args.scale),
          flex: "1 1 0",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                fontFamily: "DejaVuMono",
                fontSize: args.stageLabelFont,
                color: COLOUR_GOLD,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              },
              children: s.label,
            },
          },
          renderFlagCircle({
            code: opponent,
            flag,
            size: circleSize,
            codeFont: args.codeFont,
            scrim: "rgba(15,23,42,0.32)", // softened scrim for the light champion panel
          }),
        ],
      },
    });
  });
  return out;
}

/** A circular cell with the team's flag behind a dark scrim and the
 * 3-letter code centred on top. Falls back to the original
 * charcoal-fill circle when a flag isn't available (unknown code or
 * SVG missing from public/flags/). Used by both the KO ladder and a
 * larger variant by the champion panel.
 *
 * Style props are built up via separate objects so we don't hand
 * satori `undefined` values (its CSS parser barfs on those in some
 * paths). Tim 2026-05-22.
 */
function renderFlagCircle(args: {
  code: string;
  flag: string | null;
  size: number;
  codeFont: number;
  scrim: string;
}): unknown {
  const isEmpty = args.code === " - ";
  const hasFlag = !isEmpty && !!args.flag;

  const outerBase: Record<string, unknown> = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: args.size,
    height: args.size,
    borderRadius: 999,
    border: `2px solid ${isEmpty ? COLOUR_BORDER : COLOUR_BORDER_STRONG}`,
    boxShadow: `0 0 16px ${isEmpty ? "transparent" : "rgba(220,169,75,0.35)"}`,
    overflow: "hidden",
  };
  if (hasFlag) {
    outerBase.backgroundImage = `url("${args.flag}")`;
    outerBase.backgroundSize = "cover";
    outerBase.backgroundPosition = "center";
  } else {
    outerBase.background = isEmpty ? "rgba(255,255,255,0.03)" : COLOUR_BG;
  }

  const innerBase: Record<string, unknown> = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: args.size,
    height: args.size,
    borderRadius: 999,
    fontFamily: "Fraunces",
    fontSize: args.codeFont,
    fontWeight: 700,
    color: COLOUR_FG_STRONG,
  };
  if (hasFlag) {
    innerBase.background = args.scrim;
    innerBase.textShadow = "0 1px 2px rgba(15,23,42,0.18)";
  }

  return {
    type: "div",
    props: {
      style: outerBase,
      children: [
        {
          type: "div",
          props: {
            style: innerBase,
            children: args.code,
          },
        },
      ],
    },
  };
}

function renderChampionPanel(args: {
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  font: number;
  stageLabelFont: number;
  scale: number;
  flagsByCode: Map<string, string>;
}): unknown {
  const champ = args.champion ?? " - ";
  const flag = args.champion ? args.flagsByCode.get(args.champion) ?? null : null;
  const runnerFlag = args.runnerUp ? args.flagsByCode.get(args.runnerUp) ?? null : null;
  const thirdFlag = args.third ? args.flagsByCode.get(args.third) ?? null : null;
  const hasFlag = !!flag;
  const scrim =
    "linear-gradient(180deg, rgba(20,20,24,0.62), rgba(20,20,24,0.84))";
  const fallbackBg =
    "linear-gradient(180deg, rgba(252,211,77,0.10), rgba(154,106,23,0.06))";

  const outerBase: Record<string, unknown> = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: Math.round(6 * args.scale),
    padding: Math.round(22 * args.scale),
    border: `2px solid ${COLOUR_BORDER_STRONG}`,
    borderRadius: Math.round(14 * args.scale),
    minWidth: Math.round(200 * args.scale),
    overflow: "hidden",
  };
  if (hasFlag) {
    outerBase.backgroundImage = `url("${flag}")`;
    outerBase.backgroundSize = "cover";
    outerBase.backgroundPosition = "center";
  } else {
    outerBase.background = fallbackBg;
  }

  const childArgs = {
    runnerUp: args.runnerUp,
    third: args.third,
    font: args.font,
    stageLabelFont: args.stageLabelFont,
    scale: args.scale,
    runnerFlag,
    thirdFlag,
  };

  if (!hasFlag) {
    return {
      type: "div",
      props: {
        style: outerBase,
        children: championPanelChildren(childArgs, champ),
      },
    };
  }

  return {
    type: "div",
    props: {
      style: outerBase,
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: Math.round(6 * args.scale),
              padding: Math.round(28 * args.scale),
              width: "100%",
              background: scrim,
              borderRadius: Math.round(14 * args.scale),
            },
            children: championPanelChildren(childArgs, champ),
          },
        },
      ],
    },
  };
}

function championPanelChildren(
  args: {
    runnerUp: string | null;
    third: string | null;
    font: number;
    stageLabelFont: number;
    scale: number;
    runnerFlag: string | null;
    thirdFlag: string | null;
  },
  champ: string,
): unknown[] {
  const podiumChipSize = Math.round(34 * args.scale);
  function podiumChip(label: string, code: string | null, flag: string | null): unknown {
    const has = !!flag;
    const circle: Record<string, unknown> = {
      display: "flex",
      width: podiumChipSize,
      height: podiumChipSize,
      borderRadius: "50%",
      border: `1px solid ${COLOUR_BORDER_STRONG}`,
      overflow: "hidden",
      flexShrink: 0,
    };
    if (has) {
      circle.backgroundImage = `url("${flag}")`;
      circle.backgroundSize = "cover";
      circle.backgroundPosition = "center";
    } else {
      circle.background = "rgba(255,255,255,0.06)";
    }
    return {
      type: "div",
      props: {
        style: {
          display: "flex",
          alignItems: "center",
          gap: Math.round(10 * args.scale),
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                fontFamily: "DejaVuMono",
                fontSize: Math.round(args.stageLabelFont * 0.95),
                color: COLOUR_GOLD,
                letterSpacing: "0.16em",
                fontWeight: 700,
              },
              children: label,
            },
          },
          { type: "div", props: { style: circle, children: "" } },
          {
            type: "div",
            props: {
              style: {
                fontFamily: "Fraunces",
                fontSize: Math.round(args.stageLabelFont * 1.5),
                color: COLOUR_FG_STRONG,
                fontWeight: 700,
                letterSpacing: "0.02em",
              },
              children: code ?? " - ",
            },
          },
        ],
      },
    };
  }

  return [
    {
      type: "div",
      props: {
        style: {
          fontFamily: "DejaVuMono",
          fontSize: Math.round(args.stageLabelFont * 1.15),
          color: COLOUR_GOLD_BRIGHT,
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          fontWeight: 700,
          marginBottom: Math.round(4 * args.scale),
          textShadow:
            "0 1px 3px rgba(15,23,42,0.22)",
        },
        children: "WORLD CHAMPION",
      },
    },
    {
      type: "div",
      props: {
        style: {
          fontFamily: "Fraunces",
          fontSize: args.font,
          fontWeight: 700,
          color: COLOUR_GOLD_BRIGHT,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          textShadow: "0 2px 6px rgba(15,23,42,0.20), 0 0 24px rgba(200, 154, 42, 0.35)",
        },
        children: champ,
      },
    },
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          gap: Math.round(28 * args.scale),
          marginTop: Math.round(14 * args.scale),
          alignItems: "center",
        },
        children: [
          podiumChip("SILVER", args.runnerUp, args.runnerFlag),
          podiumChip("BRONZE", args.third, args.thirdFlag),
        ],
      },
    },
  ];
}

/**
 * Brand-mark loader. Reads `public/icon-mark.png` from disk once and
 * caches as a base64 data URI, so the satori tree can drop it straight
 * into an `<img>` without further async work. The mark is the gold
 * soccer ball used across play.tournamental.com (see header). Tim
 * 2026-05-25 - replaces the previous handcrafted SVG approximation.
 */
let iconMarkCache: string | null = null;
async function loadIconMark(): Promise<string | null> {
  if (iconMarkCache !== null) return iconMarkCache || null;
  const path = join(process.cwd(), "public", "icon-mark.png");
  try {
    const data = await fs.readFile(path);
    iconMarkCache = `data:image/png;base64,${data.toString("base64")}`;
    return iconMarkCache;
  } catch {
    iconMarkCache = "";
    return null;
  }
}

function renderGoldBall(size: number, dataUri: string | null): unknown {
  if (dataUri) {
    return {
      type: "img",
      props: {
        src: dataUri,
        width: size,
        height: size,
      },
    };
  }
  // Fallback: stylised gold ball when the PNG can't be loaded.
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
      <polygon points="50,30 65,42 60,60 40,60 35,42" fill="#0f172a" opacity="0.55" />
      <polygon points="20,38 33,32 38,44 28,52 18,46" fill="#0f172a" opacity="0.32" />
      <polygon points="82,38 87,46 78,52 68,44 73,32" fill="#0f172a" opacity="0.32" />
      <polygon points="50,72 60,80 50,90 40,80" fill="#0f172a" opacity="0.32" />
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
