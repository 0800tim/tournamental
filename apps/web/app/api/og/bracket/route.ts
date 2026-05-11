/**
 * /api/og/bracket, OG image generator for shared brackets.
 *
 * Renders a rich gold/silver/bronze podium card via the canvas pipeline
 * in `@vtorn/social-cards` (see
 * `packages/social-cards/src/canvas/bracket-share-card.ts`). Replaces
 * the v0.1 satori plain-text gradient.
 *
 * Query params (all optional except `bracket_id`):
 *   - bracket_id (required), content-addressed bracket id.
 *   - size       (landscape|portrait|square, default landscape)
 *       - landscape → 1200×630 , X / FB / LinkedIn / Telegram unfurl.
 *       - portrait  → 1080×1350, Instagram feed / Facebook / generic.
 *       - square    → 1080×1080, Instagram square / Slack / WhatsApp.
 *   - handle, name       , user display.
 *   - winner             , 3-letter champion code (e.g. ARG).
 *   - runner_up          , 3-letter silver code.
 *   - third              , 3-letter bronze code.
 *   - kit                , override champion kit primary (#hex).
 *   - path               , knockout path: r16:JPN,qf:ESP,sf:BRA,final:FRA.
 *   - tournament         , tournament name (default "FIFA WC 2026").
 *   - pundit             , verified-pundit level (omit for none).
 *   - locked             , legacy alias for picks-saved; preserved for
 *                           back-compat with social posts before
 *                           2026-05-11. Ignored by the renderer (the
 *                           podium card no longer surfaces this number).
 *
 * Bracket resolution:
 *   1. Try `${VTORN_GAME_URL}/v1/bracket/<bracket_id>` server-side. If it
 *      answers within ~750 ms and the payload has a champion / cascade,
 *      we use that.
 *   2. On any failure (timeout, 404, network, parse error) we fall back
 *      to the inline query-param hints so the route never 500s, this
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

/** Game-service fetch timeout, we'd rather show a query-param card than wait. */
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
    // 1) Build the inline-query input first, this is the always-works path.
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
    // Last-resort safety net, never let this route 500 if we can help it.
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
    // /v1/bracket/by-guid/<guid> is the canonical public lookup since PR #153/#160.
    // It runs the server-side cascade so `champion_code`, `runner_up_code`,
    // and `third_place_code` are always populated when a champion can be
    // derived from the user's picks. The legacy `/v1/bracket/<id>` is
    // user-private and not exposed publicly.
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
    return mergeByGuidPayload(inline, body);
  } catch {
    return inline;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adapter for the `/v1/bracket/by-guid/<guid>` shape. Maps the public
 * cascade fields (`champion_code`, `runner_up_code`, `third_place_code`,
 * `knockout_path[*].opponent_code`) onto the `BracketShareCardInput`
 * shape the canvas renderer expects.
 */
function mergeByGuidPayload(
  inline: BracketShareCardInput,
  body: unknown,
): BracketShareCardInput {
  if (!body || typeof body !== "object") return inline;
  const root = body as Record<string, unknown>;
  const b = (root.bracket as Record<string, unknown> | undefined) ?? null;
  if (!b) return inline;

  const champCode = readIsoCode(b.champion_code);
  const runnerCode = readIsoCode(b.runner_up_code);
  const thirdCode = readIsoCode(b.third_place_code);

  const champion =
    champCode && (inline.champion.code === "ARG" || !inline.champion.code)
      ? { code: champCode, name: champCode, kit: null }
      : inline.champion;

  const runnerUp = inline.runnerUp
    ?? (runnerCode ? { code: runnerCode, name: runnerCode, kit: null } : null);
  const thirdPlace = inline.thirdPlace
    ?? (thirdCode ? { code: thirdCode, name: thirdCode, kit: null } : null);

  let knockoutPath = inline.knockoutPath;
  if (inline.knockoutPath.length <= 1 && Array.isArray(b.knockout_path)) {
    const path = (b.knockout_path as unknown[])
      .map((e) => {
        if (!e || typeof e !== "object") return null;
        const r = e as Record<string, unknown>;
        const stage = typeof r.stage === "string" ? r.stage.toLowerCase() : null;
        const oppCode = readIsoCode(r.opponent_code);
        if (!stage || !oppCode) return null;
        if (!["r16", "qf", "sf", "tp", "final"].includes(stage)) return null;
        return {
          stage: stage as "r16" | "qf" | "sf" | "tp" | "final",
          teamCode: oppCode,
          teamName: oppCode,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (path.length > 0) knockoutPath = path;
  }

  let shareGuid = inline.shareGuid;
  if (!shareGuid && typeof b.share_guid === "string"
      && /^[a-zA-Z0-9_-]{3,64}$/.test(b.share_guid)) {
    shareGuid = b.share_guid;
  }

  return { ...inline, champion, runnerUp, thirdPlace, knockoutPath, shareGuid };
}

function readIsoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(s) ? s : null;
}

/**
 * Defensive merge, accepts any shape and only pulls fields we
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

  // Champion, only override if inline left it on the ARG default and
  // the server gave us a real value.
  const serverChamp = readChampion(src.champion);
  const champion =
    serverChamp && (inline.champion.code === "ARG" || !inline.champion.code)
      ? serverChamp
      : inline.champion;

  // Runner-up / third-place, fill in if the inline shape lacked them.
  const runnerUp =
    inline.runnerUp ?? readChampion(src.runnerUp ?? src.runner_up) ?? null;
  const thirdPlace =
    inline.thirdPlace ?? readChampion(src.thirdPlace ?? src.third_place) ?? null;

  // Knockout path, only adopt the server path if the inline had nothing
  // beyond the synthetic "final → champion" placeholder (length 1).
  let knockoutPath = inline.knockoutPath;
  if (inline.knockoutPath.length <= 1 && Array.isArray(src.knockoutPath)) {
    const path = readKnockoutPath(src.knockoutPath);
    if (path.length > 0) knockoutPath = path;
  }

  // v2: share guid + elimination tiers.
  let shareGuid = inline.shareGuid;
  if (!shareGuid) {
    const candidate =
      typeof src.shareGuid === "string"
        ? src.shareGuid
        : typeof src.share_guid === "string"
          ? src.share_guid
          : null;
    if (candidate && /^[a-zA-Z0-9_-]{3,64}$/.test(candidate)) {
      shareGuid = candidate;
    }
  }

  let allEliminatedByStage = inline.allEliminatedByStage;
  if (!allEliminatedByStage || allEliminatedByStage.length === 0) {
    const raw =
      (src.allEliminatedByStage as unknown) ??
      (src.all_eliminated_by_stage as unknown) ??
      (src.eliminatedByStage as unknown);
    if (Array.isArray(raw)) {
      const parsed = readEliminationTiers(raw);
      if (parsed.length > 0) allEliminatedByStage = parsed;
    }
  }

  return {
    ...inline,
    champion,
    runnerUp,
    thirdPlace,
    knockoutPath,
    shareGuid,
    allEliminatedByStage,
  };
}

type EliminationTier = {
  stage: "group" | "r32" | "r16" | "qf" | "sf";
  teamCodes: string[];
};

function readEliminationTiers(raw: unknown[]): EliminationTier[] {
  const TIERS = new Set(["group", "r32", "r16", "qf", "sf"]);
  const out: EliminationTier[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const stage = typeof e.stage === "string" ? e.stage.trim().toLowerCase() : null;
    if (!stage || !TIERS.has(stage)) continue;
    const codesRaw =
      (e.teamCodes as unknown) ??
      (e.team_codes as unknown) ??
      (e.teams as unknown);
    if (!Array.isArray(codesRaw)) continue;
    const teamCodes = codesRaw
      .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
      .filter((c) => /^[A-Z]{2,4}$/.test(c));
    if (teamCodes.length === 0) continue;
    out.push({
      stage: stage as "group" | "r32" | "r16" | "qf" | "sf",
      teamCodes,
    });
  }
  return out;
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
