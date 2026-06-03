/**
 * /api/og/bracket-poster, the printable Etsy-style FIFA WC26 wall poster.
 *
 * Tim 2026-06-01 (v2): rewritten as a pure-SVG generator after the
 * Satori first-pass missed the layout. The reference is the Etsy
 * "FIFA World Cup 2026 A1 wall poster" design:
 *
 *   - Dark purple-to-red radial gradient background.
 *   - "FIFA WORLD CUP 2026" hero title + subtitle banner.
 *   - 12 groups in two outer columns (A-F on the left, G-L on the
 *     right), each group a stack of 4 team rows with flag + name.
 *   - Centre: classic converging knockout bracket diagram with proper
 *     connector lines from R32 to R16 to QF to SF to FINAL, mirrored
 *     on both sides.
 *   - Gold trophy icon above the Final, red "FINAL" badge below it.
 *
 * Output: pure SVG by default (Content-Type: image/svg+xml). Vector
 * scales infinitely so the same file prints A4 / A3 / A1 cleanly. Add
 * ?format=png to rasterise via @resvg/resvg-js at 2400x3600.
 *
 * Query params:
 *   - bracket_id    Optional; if present we fetch the user's saved
 *                   bracket to overlay actual picked teams.
 *   - handle        Display handle on the footer.
 *   - champion,
 *     runner_up,
 *     third         3-letter ISO codes (overrides bracket_id picks).
 *   - format        svg (default) | png
 *
 * Caching: long edge TTL + 24h SWR, immutable per (bracket_id, format).
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import { Resvg } from "@resvg/resvg-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Constants ──────────────────────────────────────────────────────

const POSTER_W = 2400;
const POSTER_H = 3600;

// 12-group canonical 2026 layout. Same as bracket-birdseye.
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

const TEAM_NAMES: Readonly<Record<string, string>> = {
  ALG: "Algeria", ARG: "Argentina", AUS: "Australia", AUT: "Austria",
  BEL: "Belgium", BIH: "Bosnia and Herzegovina", BRA: "Brazil",
  CAN: "Canada", CIV: "Ivory Coast", COD: "DR Congo", COL: "Colombia",
  CPV: "Cape Verde", CRO: "Croatia", CUW: "Curacao", CZE: "Czechia",
  ECU: "Ecuador", EGY: "Egypt", ENG: "England", ESP: "Spain",
  FRA: "France", GER: "Germany", GHA: "Ghana", HAI: "Haiti",
  IRN: "Iran", IRQ: "Iraq", JOR: "Jordan", JPN: "Japan",
  KOR: "South Korea", KSA: "Saudi Arabia", MAR: "Morocco", MEX: "Mexico",
  NED: "Netherlands", NOR: "Norway", NZL: "New Zealand", PAN: "Panama",
  PAR: "Paraguay", POR: "Portugal", QAT: "Qatar", RSA: "South Africa",
  SCO: "Scotland", SEN: "Senegal", SUI: "Switzerland", SWE: "Sweden",
  TUN: "Tunisia", TUR: "Turkey", URU: "Uruguay", USA: "United States",
  UZB: "Uzbekistan",
};

// Flag SVG cache (raw inline SVG markup so we can embed inside <svg>).
const flagInlineCache = new Map<string, string | null>();

interface FlagAsset {
  /** The original viewBox attribute value (e.g. "0 0 800 500"). */
  readonly viewBox: string;
  /** The inner XML of the source <svg> (without the wrapping tag). */
  readonly inner: string;
}

const flagCache = new Map<string, FlagAsset | null>();

async function loadFlag(code: string): Promise<FlagAsset | null> {
  // Reads the flag SVG once per process; returns the viewBox + the
  // inner markup so we can emit it as a <symbol> in <defs> and
  // reference it with <use href="#flag-CODE" /> from each cell.
  // This works in both browser SVG rendering AND resvg-js (whereas
  // <image href="data:image/svg+xml;..."> fails in resvg).
  if (flagCache.has(code)) return flagCache.get(code) ?? null;
  const path = join(process.cwd(), "public", "flags", `${code}.svg`);
  try {
    const data = await fs.readFile(path, "utf8");
    const stripped = data.replace(/<\?xml[^>]*\?>\s*/i, "");
    const openMatch = stripped.match(/<svg\b([^>]*)>/i);
    if (!openMatch) {
      flagCache.set(code, null);
      return null;
    }
    const attrs = openMatch[1];
    let viewBox = "0 0 3 2";
    const vbMatch = attrs.match(/viewBox\s*=\s*"([^"]+)"/i);
    if (vbMatch) {
      viewBox = vbMatch[1];
    } else {
      const wMatch = attrs.match(/width\s*=\s*"?([\d.]+)/i);
      const hMatch = attrs.match(/height\s*=\s*"?([\d.]+)/i);
      if (wMatch && hMatch) viewBox = `0 0 ${wMatch[1]} ${hMatch[1]}`;
    }
    let inner = stripped
      .replace(/^[\s\S]*?<svg[^>]*>/i, "")
      .replace(/<\/svg>\s*$/i, "");
    // Strip any non-SVG namespace attributes (inkscape:, sodipodi:, etc.)
    // and the matching xmlns declarations.  resvg-js rejects unknown
    // namespace prefixes outright, and the browser SVG renderer ignores
    // them anyway, so the safe move is to remove them on read.
    inner = inner.replace(/\s(?:inkscape|sodipodi|rdf|cc|dc):[\w-]+="[^"]*"/g, "");
    inner = inner.replace(/\sxmlns:(?:inkscape|sodipodi|rdf|cc|dc)="[^"]*"/g, "");
    // Strip any <metadata>, <defs id="namedview">, or <sodipodi:namedview> blocks
    inner = inner.replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "");
    inner = inner.replace(/<sodipodi:namedview\b[\s\S]*?\/>/gi, "");
    const asset: FlagAsset = { viewBox, inner };
    flagCache.set(code, asset);
    return asset;
  } catch {
    flagCache.set(code, null);
    return null;
  }
}

async function loadAllFlags(codes: readonly string[]): Promise<Map<string, FlagAsset>> {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  await Promise.all(unique.map(loadFlag));
  const out = new Map<string, FlagAsset>();
  for (const c of unique) {
    const v = flagCache.get(c);
    if (v) out.set(c, v);
  }
  return out;
}

// ─── SVG helpers ────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface RenderArgs {
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  handle: string;
  tournament: string;
}

async function parseArgs(req: NextRequest): Promise<RenderArgs> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const champion = q.get("champion")?.toUpperCase() || null;
  const runnerUp = q.get("runner_up")?.toUpperCase() || null;
  const third = q.get("third")?.toUpperCase() || null;
  const handle = (q.get("handle") || "tournamental").toLowerCase();
  const tournament = q.get("tournament") || "FIFA WORLD CUP 2026";
  return { champion, runnerUp, third, handle, tournament };
}

// ─── SVG composition ────────────────────────────────────────────────

/**
 * Renders a single team row inside a group card.  Etsy-style:
 * tall row, big flag, bold uppercase 3-letter code, team name beside,
 * alternating row backgrounds for legibility.  The left ribbon
 * indicates advancement status (gold = 1st/2nd advance to R32,
 * amber = 3rd may advance via best-third lookup, muted = 4th out).
 */
function svgTeamRow(args: {
  x: number;
  y: number;
  w: number;
  h: number;
  code: string;
  flagSvg: FlagAsset | null;
  rank: number;
}): string {
  const { x, y, w, h, code, flagSvg, rank } = args;
  const padding = 10;
  const flagW = Math.round(h * 0.78);
  const flagH = Math.round((flagW * 2) / 3);
  const flagY = y + Math.round((h - flagH) / 2);
  // Top-2 advance is the structural promise of the group stage;
  // rank 3 may go via best-third, rank 4 is out.  Visual hierarchy:
  // gold ribbon for 1st (champion of group), bright gold for 2nd,
  // amber for 3rd, charcoal for 4th.
  const accent =
    rank === 1 ? "#fbbf24" : rank === 2 ? "#d6a23e" : rank === 3 ? "#8b6a14" : "#3b3046";
  const teamName = TEAM_NAMES[code] || code;
  // Alternating row backgrounds (rank 1+3 dark, 2+4 slightly lighter)
  // for better legibility on the gradient background.
  const rowBg = rank % 2 === 1 ? "rgba(11, 6, 18, 0.85)" : "rgba(22, 12, 32, 0.85)";
  const flagUse = flagSvg
    ? `<use href="#flag-${code}" x="${x + padding + 6}" y="${flagY}" width="${flagW}" height="${flagH}" />`
    : `<rect x="${x + padding + 6}" y="${flagY}" width="${flagW}" height="${flagH}" fill="#3b3046" />`;
  return (
    `<g class="team-row">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${rowBg}" />` +
      `<rect x="${x}" y="${y}" width="6" height="${h}" fill="${accent}" />` +
      flagUse +
      // 3-letter code in heavy uppercase, sits right after the flag.
      `<text x="${x + padding + 6 + flagW + 12}" y="${y + h / 2 + 8}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="24" letter-spacing="1" fill="#fafafa">${esc(code)}</text>` +
      // Full name, smaller, beside the code (truncated visually by font sizing).
      `<text x="${x + padding + 6 + flagW + 12 + 70}" y="${y + h / 2 + 7}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="16" fill="#cfd5e3">${esc(teamName)}</text>` +
    `</g>`
  );
}

/** One group card: a red banner header + a 4-row stack of teams. */
function svgGroupCard(args: {
  x: number;
  y: number;
  w: number;
  letter: string;
  codes: readonly string[];
  flags: Map<string, FlagAsset>;
}): string {
  const { x, y, w, letter, codes, flags } = args;
  const labelH = 38;
  const rowH = 56;
  const cards = codes.map((code, i) =>
    svgTeamRow({
      x: x,
      y: y + labelH + i * rowH,
      w,
      h: rowH,
      code,
      flagSvg: flags.get(code) ?? null,
      rank: i + 1,
    }),
  ).join("");
  const cardH = labelH + rowH * 4;
  return (
    `<g class="group group-${letter}">` +
      // Outer frame for the whole card (thin gold border).
      `<rect x="${x}" y="${y}" width="${w}" height="${cardH}" fill="none" stroke="rgba(251,191,36,0.42)" stroke-width="1.5" />` +
      // Red banner header with the group letter.
      `<rect x="${x}" y="${y}" width="${w}" height="${labelH}" fill="url(#group-header-grad)" />` +
      `<text x="${x + w / 2}" y="${y + labelH / 2 + 9}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="22" letter-spacing="6" fill="#fde68a">GROUP ${letter}</text>` +
      cards +
    `</g>`
  );
}

/** A bracket match cell. Etsy-style: dark cell, two team rows with
 *  flag + 3-letter code, match number + date below in cream type. */
function svgMatchCell(args: {
  x: number;
  y: number;
  w: number;
  h: number;
  matchNo: number;
  dateLabel: string;
  team1?: string | null;
  team2?: string | null;
  flags: Map<string, FlagAsset>;
}): string {
  const { x, y, w, h, matchNo, dateLabel, team1, team2, flags } = args;
  const rowH = (h - 4) / 2;
  const renderRow = (team: string | null | undefined, rowY: number): string => {
    const flagAsset = team ? flags.get(team) ?? null : null;
    const flagW = 26;
    const flagH = Math.round((flagW * 2) / 3);
    const flagFy = rowY + Math.round((rowH - flagH) / 2);
    const flagX = x + 8;
    return (
      `<g>` +
        (flagAsset
          ? `<use href="#flag-${team}" x="${flagX}" y="${flagFy}" width="${flagW}" height="${flagH}" />`
          : `<rect x="${flagX}" y="${flagFy}" width="${flagW}" height="${flagH}" fill="#3b3046" />`) +
        `<text x="${flagX + flagW + 8}" y="${rowY + rowH / 2 + 6}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="${team ? 800 : 500}" font-size="17" letter-spacing="1" fill="${team ? "#fafafa" : "#5a4c66"}">${esc(team || "TBD")}</text>` +
      `</g>`
    );
  };
  return (
    `<g class="match-cell">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="rgba(13,8,20,0.88)" stroke="rgba(251,191,36,0.32)" stroke-width="1" />` +
      renderRow(team1, y + 2) +
      `<line x1="${x + 4}" y1="${y + 2 + rowH}" x2="${x + w - 4}" y2="${y + 2 + rowH}" stroke="rgba(251,191,36,0.18)" stroke-width="0.8" />` +
      renderRow(team2, y + 2 + rowH) +
      `<text x="${x + w / 2}" y="${y + h + 13}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="10" letter-spacing="2" fill="#fde68a">MATCH ${matchNo}</text>` +
      `<text x="${x + w / 2}" y="${y + h + 24}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="9" letter-spacing="1" fill="#cfa8c5">${esc(dateLabel)}</text>` +
    `</g>`
  );
}

/** Bracket connector L-shape from one match cell into the next. */
function svgConnector(args: {
  fromX: number;
  fromY: number;
  midX: number;
  toY: number;
  toX: number;
}): string {
  const { fromX, fromY, midX, toY, toX } = args;
  return (
    `<path d="M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}" ` +
    `fill="none" stroke="rgba(251,191,36,0.45)" stroke-width="2.2" />`
  );
}

/** y-coordinate (top) of the i-th cell in a vertically-spread stage. */
function stageCellY(i: number, n: number, top: number, bottom: number, cellH: number): number {
  const usable = bottom - top - cellH;
  const step = n > 1 ? usable / (n - 1) : 0;
  return Math.round(top + i * step);
}

/**
 * Build the full converging bracket diagram. Returns SVG markup.
 * Layout (per side):
 *   8 R32 cells -> 4 R16 cells -> 2 QF cells -> 1 SF cell -> FINAL (centre).
 */
function svgBracketDiagram(args: {
  bracketX: number;
  bracketY: number;
  bracketW: number;
  bracketH: number;
  flags: Map<string, FlagAsset>;
  champion: string | null;
  runnerUp: string | null;
}): string {
  const { bracketX, bracketY, bracketW, bracketH, flags, champion, runnerUp } = args;
  const cellW = 200;
  const cellH = 60;
  const colCount = 9;
  const colXs: number[] = [];
  for (let i = 0; i < colCount; i += 1) {
    const colStep = (bracketW - cellW) / (colCount - 1);
    colXs.push(Math.round(bracketX + colStep * i));
  }

  const top = bracketY;
  const bottom = bracketY + bracketH;
  let svg = "";

  // Left R16 (4 cells, spread evenly across the bracket height) -- we
  // position the R16 cells FIRST, then place each R32 pair as two cells
  // tight to either side of their parent R16's vertical centre.  This
  // gives the bracket the canonical "pair gathering into pair" shape
  // instead of all 8 R32 cells spread evenly with massive air between
  // pairs.
  const r16BandH = (bottom - top) / 4;
  const r16PairGap = 28; // vertical gap between the two R32 cells in a pair
  const leftR16Ys: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r16Centre = top + r16BandH * (i + 0.5);
    const cy = Math.round(r16Centre - cellH / 2);
    leftR16Ys.push(cy);
    svg += svgMatchCell({
      x: colXs[1], y: cy, w: cellW, h: cellH,
      matchNo: 89 + i, dateLabel: "JUL 4", flags,
      team1: null, team2: null,
    });
  }
  // Left R32 (8 cells, paired around each R16)
  const leftR32Ys: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r16Centre = leftR16Ys[i] + cellH / 2;
    const aY = Math.round(r16Centre - r16PairGap / 2 - cellH);
    const bY = Math.round(r16Centre + r16PairGap / 2);
    leftR32Ys.push(aY, bY);
    svg += svgMatchCell({
      x: colXs[0], y: aY, w: cellW, h: cellH,
      matchNo: 73 + i * 2, dateLabel: "JUN 28", flags,
      team1: null, team2: null,
    });
    svg += svgMatchCell({
      x: colXs[0], y: bY, w: cellW, h: cellH,
      matchNo: 74 + i * 2, dateLabel: "JUN 28", flags,
      team1: null, team2: null,
    });
    const midX = (colXs[0] + cellW + colXs[1]) / 2;
    svg += svgConnector({ fromX: colXs[0] + cellW, fromY: aY + cellH / 2, midX, toY: leftR16Ys[i] + cellH / 2, toX: colXs[1] });
    svg += svgConnector({ fromX: colXs[0] + cellW, fromY: bY + cellH / 2, midX, toY: leftR16Ys[i] + cellH / 2, toX: colXs[1] });
  }
  // Left QF (2): position each at the midpoint of its two parent R16 cells.
  const leftQfYs: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const r16a = leftR16Ys[i * 2];
    const r16b = leftR16Ys[i * 2 + 1];
    const cy = Math.round((r16a + r16b) / 2);
    leftQfYs.push(cy);
    svg += svgMatchCell({
      x: colXs[2], y: cy, w: cellW, h: cellH,
      matchNo: 97 + i, dateLabel: "JUL 9", flags,
      team1: null, team2: null,
    });
    const midX = (colXs[1] + cellW + colXs[2]) / 2;
    svg += svgConnector({ fromX: colXs[1] + cellW, fromY: r16a + cellH / 2, midX, toY: cy + cellH / 2, toX: colXs[2] });
    svg += svgConnector({ fromX: colXs[1] + cellW, fromY: r16b + cellH / 2, midX, toY: cy + cellH / 2, toX: colXs[2] });
  }
  // Left SF (1) - vertically centred between the two QF cells.
  const leftSfY = Math.round((leftQfYs[0] + leftQfYs[1]) / 2);
  svg += svgMatchCell({
    x: colXs[3], y: leftSfY, w: cellW, h: cellH,
    matchNo: 101, dateLabel: "JUL 14", flags,
    team1: null, team2: null,
  });
  {
    const midX = (colXs[2] + cellW + colXs[3]) / 2;
    svg += svgConnector({ fromX: colXs[2] + cellW, fromY: leftQfYs[0] + cellH / 2, midX, toY: leftSfY + cellH / 2, toX: colXs[3] });
    svg += svgConnector({ fromX: colXs[2] + cellW, fromY: leftQfYs[1] + cellH / 2, midX, toY: leftSfY + cellH / 2, toX: colXs[3] });
  }

  // Right side, mirrored: R16 first, then paired R32s.
  const rightR16Ys: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r16Centre = top + r16BandH * (i + 0.5);
    const cy = Math.round(r16Centre - cellH / 2);
    rightR16Ys.push(cy);
    svg += svgMatchCell({
      x: colXs[7], y: cy, w: cellW, h: cellH,
      matchNo: 93 + i, dateLabel: "JUL 4", flags,
      team1: null, team2: null,
    });
  }
  const rightR32Ys: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r16Centre = rightR16Ys[i] + cellH / 2;
    const aY = Math.round(r16Centre - r16PairGap / 2 - cellH);
    const bY = Math.round(r16Centre + r16PairGap / 2);
    rightR32Ys.push(aY, bY);
    svg += svgMatchCell({
      x: colXs[8], y: aY, w: cellW, h: cellH,
      matchNo: 81 + i * 2, dateLabel: "JUN 28", flags,
      team1: null, team2: null,
    });
    svg += svgMatchCell({
      x: colXs[8], y: bY, w: cellW, h: cellH,
      matchNo: 82 + i * 2, dateLabel: "JUN 28", flags,
      team1: null, team2: null,
    });
    const midX = (colXs[8] + colXs[7] + cellW) / 2;
    svg += svgConnector({ fromX: colXs[8], fromY: aY + cellH / 2, midX, toY: rightR16Ys[i] + cellH / 2, toX: colXs[7] + cellW });
    svg += svgConnector({ fromX: colXs[8], fromY: bY + cellH / 2, midX, toY: rightR16Ys[i] + cellH / 2, toX: colXs[7] + cellW });
  }
  const rightQfYs: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const r16a = rightR16Ys[i * 2];
    const r16b = rightR16Ys[i * 2 + 1];
    const cy = Math.round((r16a + r16b) / 2);
    rightQfYs.push(cy);
    svg += svgMatchCell({
      x: colXs[6], y: cy, w: cellW, h: cellH,
      matchNo: 99 + i, dateLabel: "JUL 9", flags,
      team1: null, team2: null,
    });
    const midX = (colXs[7] + colXs[6] + cellW) / 2;
    svg += svgConnector({ fromX: colXs[7], fromY: r16a + cellH / 2, midX, toY: cy + cellH / 2, toX: colXs[6] + cellW });
    svg += svgConnector({ fromX: colXs[7], fromY: r16b + cellH / 2, midX, toY: cy + cellH / 2, toX: colXs[6] + cellW });
  }
  const rightSfY = Math.round((rightQfYs[0] + rightQfYs[1]) / 2);
  svg += svgMatchCell({
    x: colXs[5], y: rightSfY, w: cellW, h: cellH,
    matchNo: 102, dateLabel: "JUL 14", flags,
    team1: null, team2: null,
  });
  {
    const midX = (colXs[6] + colXs[5] + cellW) / 2;
    svg += svgConnector({ fromX: colXs[6], fromY: rightQfYs[0] + cellH / 2, midX, toY: rightSfY + cellH / 2, toX: colXs[5] + cellW });
    svg += svgConnector({ fromX: colXs[6], fromY: rightQfYs[1] + cellH / 2, midX, toY: rightSfY + cellH / 2, toX: colXs[5] + cellW });
  }

  // Centre column: trophy + Final badge. (No cell-shape here; the
  // trophy + badge IS the Final visual, as in the Etsy reference.)
  const centreX = bracketX + bracketW / 2;
  const trophyTop = (leftSfY + rightSfY) / 2 - 320;
  svg += svgTrophy({ cx: centreX, cy: trophyTop, h: 520 });
  svg += svgFinalBadge({
    cx: centreX,
    cy: trophyTop + 540,
    champion,
    runnerUp,
  });
  // Visual flourish: SF -> Final connectors.
  svg += svgConnector({
    fromX: colXs[3] + cellW,
    fromY: leftSfY + cellH / 2,
    midX: centreX - 200,
    toY: trophyTop + 400,
    toX: centreX - 130,
  });
  svg += svgConnector({
    fromX: colXs[5],
    fromY: rightSfY + cellH / 2,
    midX: centreX + 200,
    toY: trophyTop + 400,
    toX: centreX + 130,
  });

  // Stage header strip: sits just above the first cell row of the
  // bracket, well clear of the schedule banner.  Bigger chip + bolder
  // typography so it reads from across the room on a printed wall poster.
  const stageY = bracketY - 60;
  const stageChipW = 200;
  const stageChipH = 42;
  const stageLabels = [
    { x: colXs[0] + cellW / 2, label: "ROUND OF 32" },
    { x: colXs[1] + cellW / 2, label: "ROUND OF 16" },
    { x: colXs[2] + cellW / 2, label: "QUARTER FINAL" },
    { x: colXs[3] + cellW / 2, label: "SEMI FINAL" },
    { x: centreX,                label: "FINAL" },
    { x: colXs[5] + cellW / 2, label: "SEMI FINAL" },
    { x: colXs[6] + cellW / 2, label: "QUARTER FINAL" },
    { x: colXs[7] + cellW / 2, label: "ROUND OF 16" },
    { x: colXs[8] + cellW / 2, label: "ROUND OF 32" },
  ];
  for (const { x, label } of stageLabels) {
    svg += (
      `<rect x="${x - stageChipW / 2}" y="${stageY}" width="${stageChipW}" height="${stageChipH}" rx="6" fill="rgba(13,8,20,0.92)" stroke="rgba(251,191,36,0.55)" stroke-width="1.5" />` +
      `<text x="${x}" y="${stageY + stageChipH / 2 + 7}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="16" letter-spacing="2" fill="#fbbf24">${label}</text>`
    );
  }

  return svg;
}

/** Gold trophy graphic. Stylised Jules-Rimet-ish silhouette:
 *  globe-on-top above two figures, narrow waist, broad base. */
function svgTrophy(args: { cx: number; cy: number; h: number }): string {
  const { cx, cy, h } = args;
  const w = h * 0.58;
  const top = cy;
  return `
    <g class="trophy">
      <defs>
        <linearGradient id="trophy-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fef3c7" />
          <stop offset="22%" stop-color="#fde68a" />
          <stop offset="50%" stop-color="#f5c542" />
          <stop offset="78%" stop-color="#c89a2a" />
          <stop offset="100%" stop-color="#6b4a0c" />
        </linearGradient>
        <linearGradient id="trophy-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#c89a2a" />
          <stop offset="50%" stop-color="#fde68a" />
          <stop offset="100%" stop-color="#c89a2a" />
        </linearGradient>
        <radialGradient id="trophy-shine" cx="0.32" cy="0.30" r="0.55">
          <stop offset="0%" stop-color="rgba(255,255,255,0.62)" />
          <stop offset="60%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <!-- Globe (top sphere) -->
      <circle cx="${cx}" cy="${top + h * 0.15}" r="${w * 0.18}" fill="url(#trophy-grad)" stroke="#6b4a0c" stroke-width="2" />
      <ellipse cx="${cx}" cy="${top + h * 0.15}" rx="${w * 0.16}" ry="${w * 0.05}" fill="none" stroke="#6b4a0c" stroke-width="1" opacity="0.55" />
      <line x1="${cx}" y1="${top + h * 0.15 - w * 0.18}" x2="${cx}" y2="${top + h * 0.15 + w * 0.18}" stroke="#6b4a0c" stroke-width="1" opacity="0.55" />
      <!-- Cup body (two figures wrapping a stem). Stylised as a slim
           hourglass with two converging curves. -->
      <path d="
        M ${cx - w * 0.28} ${top + h * 0.30}
        Q ${cx - w * 0.36} ${top + h * 0.42}, ${cx - w * 0.18} ${top + h * 0.55}
        Q ${cx - w * 0.08} ${top + h * 0.62}, ${cx - w * 0.08} ${top + h * 0.72}
        L ${cx + w * 0.08} ${top + h * 0.72}
        Q ${cx + w * 0.08} ${top + h * 0.62}, ${cx + w * 0.18} ${top + h * 0.55}
        Q ${cx + w * 0.36} ${top + h * 0.42}, ${cx + w * 0.28} ${top + h * 0.30}
        Z" fill="url(#trophy-grad)" stroke="#6b4a0c" stroke-width="2" />
      <!-- Rim cap under the globe -->
      <rect x="${cx - w * 0.30}" y="${top + h * 0.26}" width="${w * 0.60}" height="${h * 0.05}" rx="2"
            fill="url(#trophy-rim)" stroke="#6b4a0c" stroke-width="1.5" />
      <!-- Base disc + plinth -->
      <rect x="${cx - w * 0.34}" y="${top + h * 0.72}" width="${w * 0.68}" height="${h * 0.06}" rx="2"
            fill="url(#trophy-grad)" stroke="#6b4a0c" stroke-width="1.5" />
      <rect x="${cx - w * 0.42}" y="${top + h * 0.78}" width="${w * 0.84}" height="${h * 0.10}" rx="3"
            fill="url(#trophy-grad)" stroke="#6b4a0c" stroke-width="2" />
      <rect x="${cx - w * 0.32}" y="${top + h * 0.86}" width="${w * 0.64}" height="${h * 0.06}" rx="2"
            fill="#5b3f0a" />
      <!-- Highlight shine on the cup -->
      <ellipse cx="${cx - w * 0.08}" cy="${top + h * 0.45}" rx="${w * 0.10}" ry="${h * 0.18}" fill="url(#trophy-shine)" />
      <ellipse cx="${cx - w * 0.06}" cy="${top + h * 0.15}" rx="${w * 0.06}" ry="${w * 0.06}" fill="rgba(255,255,255,0.42)" />
    </g>
  `;
}

/** Red "FINAL" badge below the trophy. */
function svgFinalBadge(args: {
  cx: number;
  cy: number;
  champion: string | null;
  runnerUp: string | null;
}): string {
  const { cx, cy, champion } = args;
  const w = 380;
  const h = 150;
  const x = cx - w / 2;
  const y = cy;
  let centreText = "MATCH 104";
  let subText = "SUN, JUL 19, 3PM ET";
  if (champion) {
    const cname = TEAM_NAMES[champion] || champion;
    centreText = `${cname.toUpperCase()}`;
    subText = "PREDICTED CHAMPION";
  }
  return `
    <g class="final-badge">
      <defs>
        <linearGradient id="final-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#dc2626" />
          <stop offset="100%" stop-color="#7f1d1d" />
        </linearGradient>
      </defs>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#final-grad)" stroke="#fbbf24" stroke-width="2" />
      <text x="${cx}" y="${y + 40}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="36" letter-spacing="6" fill="#fbbf24">FINAL</text>
      <line x1="${x + 40}" y1="${y + 58}" x2="${x + w - 40}" y2="${y + 58}" stroke="rgba(251,191,36,0.55)" stroke-width="1.5" />
      <text x="${cx}" y="${y + 98}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="26" letter-spacing="1" fill="#fafafa">${esc(centreText)}</text>
      <text x="${cx}" y="${y + 128}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="600" font-size="14" letter-spacing="3" fill="#fde68a">${esc(subText)}</text>
    </g>
  `;
}

/** Build the full poster SVG. */
function buildPosterSvg(args: {
  flags: Map<string, FlagAsset>;
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  handle: string;
  tournament: string;
}): string {
  const { flags, champion, runnerUp, handle, tournament } = args;

  // Layout zones.
  const groupColW = 360;
  const groupColXLeft = 60;
  const groupColXRight = POSTER_W - 60 - groupColW;
  const titleBlockY = 60;
  const titleBlockH = 240;
  const bodyTop = titleBlockY + titleBlockH + 60;

  // Group cards: 6 per column, stacked vertically.
  const lettersLeft = ["A", "B", "C", "D", "E", "F"];
  const lettersRight = ["G", "H", "I", "J", "K", "L"];
  const usableH = POSTER_H - bodyTop - 200;
  // Card geometry: 38px banner + 4 rows of 56px = 262px tall.
  const cardH = 38 + 4 * 56;
  const cardGap = (usableH - cardH * 6) / 5;
  const groupCards: string[] = [];
  lettersLeft.forEach((L, i) => {
    groupCards.push(svgGroupCard({
      x: groupColXLeft,
      y: bodyTop + i * (cardH + cardGap),
      w: groupColW,
      letter: L,
      codes: GROUPS[L],
      flags,
    }));
  });
  lettersRight.forEach((L, i) => {
    groupCards.push(svgGroupCard({
      x: groupColXRight,
      y: bodyTop + i * (cardH + cardGap),
      w: groupColW,
      letter: L,
      codes: GROUPS[L],
      flags,
    }));
  });

  // Bracket diagram occupies the middle column between the two group columns.
  const bracketX = groupColXLeft + groupColW + 40;
  const bracketW = groupColXRight - bracketX - 40;
  const bracketY = bodyTop + 200; // leaves room for the cream schedule banner + stage labels above the cells
  const bracketH = usableH - 250;

  const bracketSvg = svgBracketDiagram({
    bracketX, bracketY, bracketW, bracketH, flags, champion, runnerUp,
  });

  // Schedule banner above the bracket.
  const bannerY = bodyTop;
  const bannerH = 84;
  const bannerX = bracketX + 40;
  const bannerW = bracketW - 80;

  // Build <symbol> defs for every flag we'll reference.
  const flagSymbols = Array.from(flags.entries())
    .map(([code, asset]) =>
      `<symbol id="flag-${code}" viewBox="${asset.viewBox}" preserveAspectRatio="xMidYMid slice">${asset.inner}</symbol>`,
    )
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${POSTER_W}" height="${POSTER_H}" viewBox="0 0 ${POSTER_W} ${POSTER_H}"
     preserveAspectRatio="xMidYMid meet">
  <defs>
    <radialGradient id="bg-grad" cx="0.5" cy="0.55" r="0.85">
      <stop offset="0%"   stop-color="#c4264e" />
      <stop offset="45%"  stop-color="#5a1d5b" />
      <stop offset="100%" stop-color="#1a0f2e" />
    </radialGradient>
    <linearGradient id="title-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fffefa" />
      <stop offset="100%" stop-color="#fde68a" />
    </linearGradient>
    <linearGradient id="group-header-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b91c1c" />
      <stop offset="100%" stop-color="#7f1d1d" />
    </linearGradient>
    <linearGradient id="banner-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fdfbf2" />
      <stop offset="100%" stop-color="#f5e6b3" />
    </linearGradient>
    ${flagSymbols}
  </defs>
  <rect width="${POSTER_W}" height="${POSTER_H}" fill="#1a0f2e" />
  <rect width="${POSTER_W}" height="${POSTER_H}" fill="url(#bg-grad)" />
  <rect width="${POSTER_W}" height="${POSTER_H}" fill="rgba(0,0,0,0.18)" />

  <!-- Title block -->
  <text x="${POSTER_W / 2}" y="${titleBlockY + 130}" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="148"
        letter-spacing="8" fill="url(#title-grad)">${esc(tournament)}</text>
  <text x="${POSTER_W / 2}" y="${titleBlockY + 190}" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-weight="500" font-size="28"
        letter-spacing="14" fill="#fde68a" opacity="0.85">11 JUNE   ·   19 JULY   ·   USA   ·   MEXICO   ·   CANADA</text>

  <!-- Schedule banner above the bracket - cream with red text -->
  <rect x="${bannerX}" y="${bannerY}" width="${bannerW}" height="${bannerH}" rx="8"
        fill="url(#banner-grad)" stroke="#fbbf24" stroke-width="2.5" />
  <text x="${bannerX + bannerW / 2}" y="${bannerY + bannerH / 2 + 14}" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="36"
        letter-spacing="4" fill="#7f1d1d">2026 WORLD CUP MATCH SCHEDULE</text>

  <text x="${groupColXLeft + groupColW / 2}" y="${bodyTop - 16}" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="20"
        letter-spacing="6" fill="#fde68a">GROUP STAGE</text>
  <text x="${groupColXRight + groupColW / 2}" y="${bodyTop - 16}" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-weight="900" font-size="20"
        letter-spacing="6" fill="#fde68a">GROUP STAGE</text>

  ${groupCards.join("\n")}

  ${bracketSvg}

  <text x="${POSTER_W / 2}" y="${POSTER_H - 60}" text-anchor="middle"
        font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="22"
        letter-spacing="4" fill="#fde68a" opacity="0.78">PLAY.TOURNAMENTAL.COM/S/${esc(handle.toUpperCase())}</text>
</svg>`;
}

// ─── GET handler ────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<Response> {
  const args = await parseArgs(req);
  const format = (new URL(req.url).searchParams.get("format") || "svg").toLowerCase();

  // Preload every flag we will reference.
  const codes: string[] = [];
  for (const c of Object.values(GROUPS)) for (const code of c) codes.push(code);
  if (args.champion) codes.push(args.champion);
  if (args.runnerUp) codes.push(args.runnerUp);
  if (args.third) codes.push(args.third);
  const flags = await loadAllFlags(codes);

  const svg = buildPosterSvg({
    flags,
    champion: args.champion,
    runnerUp: args.runnerUp,
    third: args.third,
    handle: args.handle,
    tournament: args.tournament,
  });

  if (format === "png") {
    try {
      const resvg = new Resvg(svg, { fitTo: { mode: "width", value: POSTER_W } });
      const png = resvg.render().asPng();
      return new Response(png as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-disposition": `inline; filename="tournamental-wc26-poster.png"`,
          "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400, immutable",
        },
      });
    } catch (err) {
      return new Response(
        `<!-- PNG render failed: ${err instanceof Error ? err.message : "unknown"} -->\n${svg}`,
        {
          status: 200,
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }
  }

  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": `inline; filename="tournamental-wc26-poster.svg"`,
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400, immutable",
    },
  });
}
