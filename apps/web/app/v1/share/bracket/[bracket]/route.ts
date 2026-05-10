/**
 * `/v1/share/bracket/:bracketId(.png|.mp4)` — viral-share endpoint.
 *
 * Tim's 2026-05-11 brief: every bracket needs a beautiful PNG (for
 * Instagram / Facebook / Twitter / OG unfurls) and a 6-second animated
 * MP4 (for TikTok / Reels). Both flavours come out of the same
 * `@vtorn/social-cards` canvas renderer with no external API spend.
 *
 * Query params:
 *   - handle     (string)  — user handle to feature
 *   - name       (string)  — optional display name override
 *   - winner     (3-letter) — champion country code (default ARG)
 *   - kit        (#hex)    — override champion kit primary colour
 *   - path       (string)  — knockout path: r16:AUS,qf:ESP,sf:BRA,final:FRA
 *   - tournament (string)  — override tournament name (default "FIFA WC 2026")
 *   - pundit     (number)  — verified-pundit level chip (omit for none)
 *   - size       (portrait|landscape|square) — for the .png variant
 *   - format     (instagram|tiktok|twitter)  — for the .mp4 variant
 *
 * Cache policy:
 *   - PNG: `public, s-maxage=600, stale-while-revalidate=86400` — the
 *     bracket is content-addressed by the query string so a long edge
 *     cache + SWR keeps the hot social-network unfurl path cheap.
 *   - MP4: heavier to render (~3s of ffmpeg per request). We cache to
 *     disk under `public/share/mp4/<bracket>-<format>.mp4` for 24h.
 *     Subsequent requests stream the cached file directly.
 *
 * Per docs/22-deployment-and-tunnels.md "Public share surface" row.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NextRequest } from "next/server";

import { renderBracketShareCard, renderBracketRevealVideo, type CanvasCardSize, type VideoFormat } from "@vtorn/social-cards";

import {
  parseBracketSegment,
  inputFromSearchParams,
} from "@/lib/share/bracket-share-input";

export const runtime = "nodejs";
// Dynamic because we read query params; the CDN long-caches per URL.
export const dynamic = "force-dynamic";

const ALLOWED_SIZES = new Set<CanvasCardSize>(["portrait", "landscape", "square"]);
const ALLOWED_FORMATS = new Set<VideoFormat>(["instagram", "tiktok", "twitter"]);

interface RouteContext {
  params: { bracket: string };
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const parsed = parseBracketSegment(ctx.params.bracket);
  if (!parsed) {
    return new Response(
      JSON.stringify({ error: "invalid_bracket_segment", segment: ctx.params.bracket }),
      { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }

  const url = new URL(req.url);
  const ext = parsed.ext ?? "png"; // default to PNG when no extension supplied

  if (ext === "png") return handlePng(req, parsed.bracketId, url.searchParams);
  if (ext === "mp4") return handleMp4(req, parsed.bracketId, url.searchParams);

  return new Response(
    JSON.stringify({ error: "unsupported_extension", ext }),
    { status: 415, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}

async function handlePng(
  _req: NextRequest,
  bracketId: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const sizeRaw = (searchParams.get("size") ?? "portrait") as CanvasCardSize;
  const size = ALLOWED_SIZES.has(sizeRaw) ? sizeRaw : "portrait";
  const input = inputFromSearchParams({ bracketId, searchParams });
  try {
    const png = await renderBracketShareCard({ ...input, size });
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="bracket-${bracketId}-${size}.png"`,
        "cache-control": "public, s-maxage=600, stale-while-revalidate=86400",
        "x-vtorn-share-format": size,
      },
    });
  } catch (err) {
    return errorResponse("share_png_render_failed", err);
  }
}

async function handleMp4(
  _req: NextRequest,
  bracketId: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const formatRaw = (searchParams.get("format") ?? "instagram") as VideoFormat;
  const format = ALLOWED_FORMATS.has(formatRaw) ? formatRaw : "instagram";
  const input = inputFromSearchParams({ bracketId, searchParams });
  const cachePath = mp4CachePath(bracketId, format);
  try {
    const cached = await readFreshCache(cachePath, 24 * 60 * 60 * 1000);
    if (cached) return streamMp4(cached, bracketId, format, /*hit*/ true);
    await ensureDir(cachePath);
    await renderBracketRevealVideo({
      card: input,
      outputPath: cachePath,
      fps: 24,
      durationSec: 6,
      format,
    });
    const file = await fs.readFile(cachePath);
    return streamMp4(file, bracketId, format, /*hit*/ false);
  } catch (err) {
    return errorResponse("share_mp4_render_failed", err);
  }
}

// ---------- helpers ----------

function mp4CachePath(bracketId: string, format: VideoFormat): string {
  const safe = bracketId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  // Cache to a writable per-process temp dir (we don't want to write
  // into apps/web/public from a runtime handler — Next.js may snapshot
  // public/ at build time).
  return join(tmpdir(), "vtorn-share-mp4", `${safe}-${format}.mp4`);
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = filePath.replace(/\/[^/]*$/, "");
  await fs.mkdir(dir, { recursive: true });
}

async function readFreshCache(path: string, maxAgeMs: number): Promise<Buffer | null> {
  try {
    const stat = await fs.stat(path);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return await fs.readFile(path);
  } catch {
    return null;
  }
}

function streamMp4(buf: Buffer, bracketId: string, format: VideoFormat, hit: boolean): Response {
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "video/mp4",
      "content-disposition": `inline; filename="bracket-${bracketId}-${format}.mp4"`,
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "x-vtorn-share-format": format,
      "x-vtorn-cache": hit ? "hit" : "miss",
    },
  });
}

function errorResponse(code: string, err: unknown): Response {
  return new Response(
    JSON.stringify({ error: code, detail: err instanceof Error ? err.message : String(err) }),
    { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
