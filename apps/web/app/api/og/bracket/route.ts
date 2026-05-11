/**
 * /api/og/bracket — OG image generator for shared brackets.
 *
 * Renders a rich gold/silver/bronze podium card via the canvas pipeline
 * in `@vtorn/social-cards` (see
 * `packages/social-cards/src/canvas/bracket-share-card.ts`). Replaces
 * the v0.1 satori plain-text gradient.
 *
 * Query params (all optional except `bracket_id`):
 *   - bracket_id (required) — content-addressed bracket id.
 *   - size       (landscape|portrait|square, default landscape)
 *       - landscape → 1200×630  — X / FB / LinkedIn / Telegram unfurl.
 *       - portrait  → 1080×1350 — Instagram feed / Facebook / generic.
 *       - square    → 1080×1080 — Instagram square / Slack / WhatsApp.
 *   - handle, name        — user display.
 *   - winner              — 3-letter champion code (e.g. ARG).
 *   - runner_up           — 3-letter silver code.
 *   - third               — 3-letter bronze code.
 *   - kit                 — override champion kit primary (#hex).
 *   - path                — knockout path: r16:JPN,qf:ESP,sf:BRA,final:FRA.
 *   - tournament          — tournament name (default "FIFA WC 2026").
 *   - pundit              — verified-pundit level (omit for none).
 *   - locked              — legacy alias for picks-saved; preserved for
 *                           back-compat with social posts before
 *                           2026-05-11. Ignored by the renderer (the
 *                           podium card no longer surfaces this number).
 *
 * Bracket resolution:
 *   1. Try `${VTORN_GAME_URL}/v1/bracket/<bracket_id>` server-side. If it
 *      answers within ~750 ms and the payload has a champion / cascade,
 *      we use that.
 *   2. On any failure (timeout, 404, network, parse error) we fall back
 *      to the inline query-param hints so the route never 500s — this
 *      image is publicly cached and a 500 poisons the link.
 *
 * Caching:
 *   - On-disk PNG at `apps/web/public/og/bracket/<id>-<size>.png` so the
 *     second request hits the static file via Next.js's public asset
 *     handler.
 *   - HTTP: `Cache-Control: public, s-maxage=86400,
 *     stale-while-revalidate=604800, immutable`. The bracket id +
 *     `size` query param fully address the output.
 *
 * Performance: the canvas renderer caches its font registration and its
 * flag-PNG raster cache in module scope. Cold path ~250-400 ms on the
 * dev box, warm cache <120 ms.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";

import {
  renderBracketShareCard,
  type BracketShareCardInput,
  type CanvasCardSize,
} from "@vtorn/social-cards";

import {
  inputFromSearchParams,
  isValidBracketId,
} from "@/lib/share/bracket-share-input";

export const runtime = "nodejs";
// Dynamic because the route reads query params; the CDN long-caches per URL.
export const dynamic = "force-dynamic";

const ALLOWED_SIZES: ReadonlySet<CanvasCardSize> = new Set([
  "landscape",
  "portrait",
  "square",
]);

const DEFAULT_SIZE: CanvasCardSize = "landscape";

const GAME_BASE =
  process.env.VTORN_GAME_URL ??
  process.env.NEXT_PUBLIC_VTORN_GAME_URL ??
  "https://vtorn-game.aiva.nz";

/** Game-service fetch timeout — we'd rather show a query-param card than wait. */
const FETCH_TIMEOUT_MS = 750;

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const bracketIdRaw = url.searchParams.get("bracket_id") ?? "default";
  const safeBracketId = bracketIdRaw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

  const sizeRaw = url.searchParams.get("size");
  const size: CanvasCardSize =
    sizeRaw && ALLOWED_SIZES.has(sizeRaw as CanvasCardSize)
      ? (sizeRaw as CanvasCardSize)
      : DEFAULT_SIZE;

  try {
    // 1) Build the inline-query input first — this is the always-works path.
    const inlineInput = inputFromSearchParams({
      bracketId: safeBracketId,
      searchParams: url.searchParams,
    });

    // 2) Best-effort: enrich from the game-service if the id looks valid.
    //    Any failure is swallowed; we ship the inline card.
    const enriched = isValidBracketId(safeBracketId)
      ? await tryEnrichFromGameService(safeBracketId, inlineInput).catch(() => inlineInput)
      : inlineInput;

    const png = await renderBracketShareCard({ ...enriched, size });

    // Fire-and-forget on-disk cache. Keep the response on the hot path.
    void tryDiskCache(safeBracketId, size, png);

    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="bracket-${safeBracketId}-${size}.png"`,
        "cache-control":
          "public, s-maxage=86400, stale-while-revalidate=604800, immutable",
        "x-vtorn-og-size": size,
      },
    });
  } catch (err) {
    // Last-resort safety net — never let this route 500 if we can help it.
    // A poisoned 500 in a CDN ruins every share link until the cache evicts.
    return new Response(
      JSON.stringify({
        error: "og_render_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }
}

/**
 * Try to fetch the bracket from the game-service and merge any
 * server-resolved cascade fields onto the inline-query input. Inline
 * fields win when both are present (the caller can always override).
 */
async function tryEnrichFromGameService(
  bracketId: string,
  inline: BracketShareCardInput,
): Promise<BracketShareCardInput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${GAME_BASE}/v1/bracket/${encodeURIComponent(bracketId)}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      // Bypass Next's data cache; we run our own disk cache below.
      cache: "no-store",
    });
    if (!res.ok) return inline;
    const body = (await res.json()) as unknown;
    return mergeBracketPayload(inline, body);
  } catch {
    return inline;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Defensive merge — accepts any shape and only pulls fields we
 * recognise. Inline query-param fields take precedence so the caller
 * stays in control.
 */
function mergeBracketPayload(
  inline: BracketShareCardInput,
  body: unknown,
): BracketShareCardInput {
  if (!body || typeof body !== "object") return inline;
  const obj = body as Record<string, unknown>;

  // The bracket service might shape its response a few different ways.
  // We accept either a flat `{ champion, runnerUp, thirdPlace,
  // knockoutPath, user, tournamentName }` or a nested
  // `{ bracket: { ... } }`.
  const src = (obj.bracket as Record<string, unknown> | undefined) ?? obj;

  // Champion — only override if inline left it on the ARG default and
  // the server gave us a real value.
  const serverChamp = readChampion(src.champion);
  const champion =
    serverChamp && (inline.champion.code === "ARG" || !inline.champion.code)
      ? serverChamp
      : inline.champion;

  // Runner-up / third-place — fill in if the inline shape lacked them.
  const runnerUp =
    inline.runnerUp ?? readChampion(src.runnerUp ?? src.runner_up) ?? null;
  const thirdPlace =
    inline.thirdPlace ?? readChampion(src.thirdPlace ?? src.third_place) ?? null;

  // Knockout path — only adopt the server path if the inline had nothing
  // beyond the synthetic "final → champion" placeholder (length 1).
  let knockoutPath = inline.knockoutPath;
  if (inline.knockoutPath.length <= 1 && Array.isArray(src.knockoutPath)) {
    const path = readKnockoutPath(src.knockoutPath);
    if (path.length > 0) knockoutPath = path;
  }

  return {
    ...inline,
    champion,
    runnerUp,
    thirdPlace,
    knockoutPath,
  };
}

function readChampion(raw: unknown): BracketShareCardInput["champion"] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code.trim().toUpperCase() : null;
  if (!code || !/^[A-Z]{2,4}$/.test(code)) return null;
  const name = typeof r.name === "string" ? r.name : code;
  let kit: { primary?: string | null } | null = null;
  if (r.kit && typeof r.kit === "object") {
    const kr = r.kit as Record<string, unknown>;
    const primary = typeof kr.primary === "string" ? kr.primary : null;
    kit = { primary };
  }
  return { code, name, kit };
}

function readKnockoutPath(raw: unknown[]): BracketShareCardInput["knockoutPath"] {
  const STAGES = new Set(["r16", "qf", "sf", "tp", "final"]);
  const out: Array<{ stage: "r16" | "qf" | "sf" | "tp" | "final"; teamCode: string; teamName: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const stage =
      typeof e.stage === "string" ? e.stage.trim().toLowerCase() : null;
    const teamCode =
      typeof e.teamCode === "string"
        ? e.teamCode.trim().toUpperCase()
        : typeof e.team_code === "string"
          ? e.team_code.trim().toUpperCase()
          : null;
    const teamName =
      typeof e.teamName === "string"
        ? e.teamName
        : typeof e.team_name === "string"
          ? e.team_name
          : null;
    if (!stage || !STAGES.has(stage)) continue;
    if (!teamCode || !/^[A-Z]{2,4}$/.test(teamCode)) continue;
    out.push({
      stage: stage as "r16" | "qf" | "sf" | "tp" | "final",
      teamCode,
      teamName: teamName ?? teamCode,
    });
  }
  return out;
}

/**
 * Best-effort on-disk cache. We write to `apps/web/public/og/bracket/`
 * so the next request hits the static-asset handler. Caches are keyed
 * by `<safeBracketId>-<size>.png` so each aspect ratio has its own
 * snapshot.
 */
async function tryDiskCache(
  bracketId: string,
  size: CanvasCardSize,
  png: Buffer,
): Promise<string | null> {
  const dir = join(process.cwd(), "public", "og", "bracket");
  const file = join(dir, `${bracketId}-${size}.png`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, png);
    return file;
  } catch {
    return null;
  }
}
