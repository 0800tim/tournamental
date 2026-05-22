/**
 * /api/og/bracket-birdseye, the "full tournament planner" share card.
 *
 * Renders the entire 48-team Football World Cup 2026 surface in one
 * frame: 12 group cards (flag emojis + ABBR) above a knockout
 * cascade that traces the user's gold-path (R16 → QF → SF → Final →
 * Champion). Shareable as a single PNG to WhatsApp / Insta / X /
 * Telegram as the "this is my whole bracket" brag (Tim 2026-05-22,
 * doc 36 §F item 11).
 *
 * Sizes:
 *   - portrait (1080×1920) — STORY-shaped, the default for share menus.
 *   - landscape (1200×630) — X / FB / Telegram unfurl.
 *   - square (1080×1080)   — Insta square / Slack / WhatsApp thumb.
 *
 * Query params (all optional, render-safe placeholders if absent):
 *   - bracket_id (preferred), the user's share guid; if present we
 *     fetch /v1/bracket/by-guid/<id> from the game service to resolve
 *     champion + runner-up + third + knockout_path.
 *   - champion, runner_up, third — 3-letter codes (fallback when no id).
 *   - ko — pipe-delimited path "r16:MEX|qf:BRA|sf:GER|final:FRA" of the
 *     opponents the user predicted to beat at each stage.
 *   - handle — the predictor's display handle (shown in the dateline).
 *   - tournament — defaults to "FWC2026".
 *   - size — portrait | landscape | square.
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Size = "portrait" | "landscape" | "square";

const SIZES: Readonly<Record<Size, { width: number; height: number }>> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
};

const COLOUR_BG = "#15151a";
const COLOUR_FG_STRONG = "#ffffff";
const COLOUR_FG_MUTED = "#a3a3ad";
const COLOUR_GOLD = "#dca94b";
const COLOUR_GOLD_BRIGHT = "#fcd34d";
const COLOUR_GOLD_DEEP = "#9a6a17";
const COLOUR_BORDER = "rgba(220, 169, 75, 0.18)";
const COLOUR_BORDER_STRONG = "rgba(220, 169, 75, 0.42)";
const COLOUR_CHIP_BG = "rgba(255, 255, 255, 0.04)";

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
  stage: "r16" | "qf" | "sf" | "final" | "tp";
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
      if (!["r16", "qf", "sf", "final", "tp"].includes(s)) return null;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GAME_BASE}/v1/bracket/by-guid/${encodeURIComponent(bracketId)}`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) return inline;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== "object") return inline;
    const root = body as Record<string, unknown>;
    const b = (root.bracket as Record<string, unknown> | undefined) ?? null;
    if (!b) return inline;
    const champion = inline.champion ?? isoCode(b.champion_code as string | undefined);
    const runnerUp = inline.runnerUp ?? isoCode(b.runner_up_code as string | undefined);
    const third = inline.third ?? isoCode(b.third_place_code as string | undefined);
    let ko = inline.ko;
    if (ko.length === 0 && Array.isArray(b.knockout_path)) {
      ko = (b.knockout_path as unknown[])
        .map((e) => {
          if (!e || typeof e !== "object") return null;
          const r = e as Record<string, unknown>;
          const stage = typeof r.stage === "string" ? r.stage.toLowerCase() : null;
          const opp = isoCode(r.opponent_code as string | undefined);
          if (!stage || !opp) return null;
          if (!["r16", "qf", "sf", "final", "tp"].includes(stage)) return null;
          return { stage: stage as KoPick["stage"], opponent: opp };
        })
        .filter((x): x is KoPick => x !== null);
    }
    return { ...inline, champion, runnerUp, third, ko };
  } catch {
    return inline;
  } finally {
    clearTimeout(timer);
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

// ─── Render ─────────────────────────────────────────────────────────

async function renderPNG(args: RenderArgs): Promise<Buffer> {
  const { width, height } = SIZES[args.size];
  const fonts = await loadFonts();
  // Preload flag SVGs for every team referenced in the KO ladder +
  // podium so the satori tree can drop them straight into
  // backgroundImage URLs without further async work. Tim 2026-05-22.
  const flagCodes: string[] = [];
  for (const p of args.ko) flagCodes.push(p.opponent);
  if (args.champion) flagCodes.push(args.champion);
  if (args.runnerUp) flagCodes.push(args.runnerUp);
  if (args.third) flagCodes.push(args.third);
  const flagsByCode = await loadFlagDataUris(flagCodes);
  const isPortrait = args.size === "portrait";
  const isLandscape = args.size === "landscape";

  // Per-size paddings + scale.
  const padding = isPortrait ? 56 : isLandscape ? 48 : 60;
  const scale = isPortrait ? 1 : isLandscape ? 0.7 : 0.86;

  // KO stage picks indexed by stage.
  const koByStage = new Map(args.ko.map((p) => [p.stage, p.opponent] as const));

  const datelineFont = Math.round(22 * scale);
  const titleFont = Math.round(58 * scale);
  const handleFont = Math.round(32 * scale);
  const groupLetterFont = Math.round(22 * scale);
  const groupCodeFont = Math.round(22 * scale);
  const groupFlagFont = Math.round(28 * scale);
  const stageLabelFont = Math.round(16 * scale);
  const koCodeFont = Math.round(28 * scale);
  const koFlagFont = Math.round(34 * scale);
  const championFont = Math.round(96 * scale);
  const ballSize = Math.round(72 * scale);

  const dateline = `${args.tournament} · BRACKET · @${args.handle.toUpperCase()}`;

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
                    renderGoldBall(ballSize),
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
                  children: "My World Cup 2026.",
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
              }),
            ),
          },
        },

        // ─── Knockout cascade + champion.
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: isLandscape ? "row" : "column",
              alignItems: "stretch",
              gap: Math.round(16 * scale),
              flex: "1 1 auto",
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
                    padding: Math.round(18 * scale),
                    background: "rgba(255, 255, 255, 0.02)",
                    border: `1px solid ${COLOUR_BORDER}`,
                    borderRadius: Math.round(14 * scale),
                    flex: "1 1 auto",
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

        // Footer
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
              marginTop: "auto",
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
}): unknown {
  // Compute pixel-width approximation for flex item. satori's flexbox
  // engine handles `width: <pct>` by referencing the parent's content
  // box, so we shrink each cell to fit cols + (cols-1) gap segments.
  const gapAllowance = args.gap * (args.cols - 1);
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
              gap: Math.round(3 * args.scale),
            },
            children: args.codes.map((code, idx) => ({
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
                  code,
                ],
              },
            })),
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
    { key: "r16", label: "R16" },
    { key: "qf", label: "QF" },
    { key: "sf", label: "SF" },
    { key: "final", label: "FINAL" },
  ];
  const circleSize = Math.round(86 * args.scale);
  return stages.map((s) => {
    const opponent = args.koByStage.get(s.key) ?? "—";
    const flag = opponent === "—" ? null : args.flagsByCode.get(opponent) ?? null;
    return {
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
                color: COLOUR_FG_MUTED,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              },
              children: s.label,
            },
          },
          renderFlagCircle({
            code: opponent,
            flag,
            size: circleSize,
            codeFont: args.codeFont,
            scrim: "rgba(0,0,0,0.55)",
          }),
          {
            type: "div",
            props: {
              style: {
                fontFamily: "DejaVuMono",
                fontSize: Math.round(args.stageLabelFont * 0.85),
                color: COLOUR_GOLD_DEEP,
                letterSpacing: "0.14em",
              },
              children: opponent === "—" ? "" : "BEAT",
            },
          },
        ],
      },
    };
  });
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
  const isEmpty = args.code === "—";
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
    innerBase.textShadow = "0 1px 4px rgba(0,0,0,0.55)";
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
  const champ = args.champion ?? "—";
  const flag = args.champion ? args.flagsByCode.get(args.champion) ?? null : null;
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

  if (!hasFlag) {
    return {
      type: "div",
      props: {
        style: outerBase,
        children: championPanelChildren(args, champ),
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
              padding: Math.round(22 * args.scale),
              width: "100%",
              background: scrim,
              borderRadius: Math.round(14 * args.scale),
            },
            children: championPanelChildren(args, champ),
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
  },
  champ: string,
): unknown[] {
  return [
    {
      type: "div",
      props: {
        style: {
          fontFamily: "DejaVuMono",
          fontSize: args.stageLabelFont,
          color: COLOUR_GOLD,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 700,
        },
        children: "CHAMPION",
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
          textShadow: "0 2px 14px rgba(0,0,0,0.65), 0 0 30px rgba(252, 211, 77, 0.45)",
        },
        children: champ,
      },
    },
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          gap: Math.round(16 * args.scale),
          marginTop: Math.round(6 * args.scale),
          fontFamily: "DejaVuMono",
          fontSize: Math.round(args.stageLabelFont * 0.9),
          color: COLOUR_FG_MUTED,
          letterSpacing: "0.12em",
        },
        children: [
          `🥈 ${args.runnerUp ?? "—"}`,
          `🥉 ${args.third ?? "—"}`,
        ],
      },
    },
  ];
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
