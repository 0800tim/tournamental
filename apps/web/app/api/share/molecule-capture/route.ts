/**
 * /api/share/molecule-capture, capture-and-share composer for the 3D
 * molecule pyramid.
 *
 * The client captures the user's exact WebGL camera pose via
 * `canvas.toDataURL('image/png')` and POSTs it here as base64. The
 * server overlays a prediction-card strip (champion + path-to-gold +
 * handle + Tournamental wordmark + `/s/<guid>` URL + QR) and returns
 * the composed PNG.
 *
 * Why server-side (and not client-side OffscreenCanvas):
 *
 *   - QR rendering needs the `qrcode` npm package which is ~30 kB
 *     gzipped on its own. Adding that plus a flag-PNG loader plus the
 *     full bracket-share-card layout helpers to the molecule page chunk
 *     would blow the 10 kB bundle budget called out in the brief.
 *   - We already ship a battle-tested canvas composer in
 *     `@tournamental/social-cards` (PR #151 v2). The new
 *     `renderMoleculeCaptureCard` helper reuses its palette, font
 *     registry, and QR cache, so the molecule capture matches the rest
 *     of the share surface for free.
 *   - The round-trip is ~300-700 ms warm. The user is sharing, not
 *     animating, so it's invisible in practice.
 *
 * The composed image is **not** cached, capture results are unique per
 * pose. `Cache-Control: no-store` per docs/22-deployment-and-tunnels.md.
 *
 * Request body (JSON):
 *   {
 *     "captureDataUrl": "data:image/png;base64,...",        // required
 *     "size": "landscape" | "portrait" | "square",          // default landscape
 *     "shareGuid": "<3-64 char id>",                        // for /s/<guid> URL + QR
 *     "champion": { "code": "ARG", "name": "Argentina",
 *                   "kit": { "primary": "#75aadb" } },      // optional
 *     "runnerUp":   { "code": "FRA", "name": "France" },    // optional
 *     "thirdPlace": { "code": "BRA", "name": "Brazil" },    // optional
 *     "knockoutPath": [
 *       { "stage": "r16",   "teamCode": "JPN", "teamName": "Japan" },
 *       { "stage": "qf",    "teamCode": "ESP", "teamName": "Spain" },
 *       { "stage": "sf",    "teamCode": "BRA", "teamName": "Brazil" },
 *       { "stage": "final", "teamCode": "FRA", "teamName": "France" }
 *     ],
 *     "handle":         "messi-fan",                         // optional
 *     "tournamentName": "FIFA WC 2026"                       // optional
 *   }
 *
 * Response: image/png, 1200×630 (landscape) by default.
 */

import type { NextRequest } from "next/server";

import {
  decodeCaptureDataUrl,
  renderMoleculeCaptureCard,
  type CanvasCardSize,
  type MoleculeCaptureCardInput,
  type MoleculeCaptureChampion,
  type MoleculeCapturePathEntry,
} from "@tournamental/social-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SIZES: ReadonlySet<CanvasCardSize> = new Set([
  "landscape",
  "portrait",
  "square",
]);

interface CaptureRequest {
  captureDataUrl?: string;
  size?: CanvasCardSize;
  shareGuid?: string | null;
  champion?: MoleculeCaptureChampion | null;
  runnerUp?: MoleculeCaptureChampion | null;
  thirdPlace?: MoleculeCaptureChampion | null;
  knockoutPath?: ReadonlyArray<MoleculeCapturePathEntry>;
  handle?: string | null;
  tournamentName?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: CaptureRequest;
  try {
    body = (await req.json()) as CaptureRequest;
  } catch {
    return jsonError(400, "invalid_body", "request body is not valid JSON");
  }

  const captureBuf = decodeCaptureDataUrl(body.captureDataUrl);
  if (!captureBuf) {
    return jsonError(
      400,
      "invalid_capture",
      "captureDataUrl must be a base64 image/png data URL (<=6MB decoded)",
    );
  }

  const size: CanvasCardSize =
    body.size && ALLOWED_SIZES.has(body.size) ? body.size : "landscape";

  // Light validation on user-supplied identifiers so we can't poison the
  // QR code or the URL with arbitrary content.
  const shareGuid =
    typeof body.shareGuid === "string" && /^[a-zA-Z0-9_-]{3,64}$/.test(body.shareGuid)
      ? body.shareGuid
      : null;
  const handle = sanitiseHandle(body.handle);

  const input: MoleculeCaptureCardInput = {
    captureBuf,
    size,
    shareGuid,
    handle,
    tournamentName: sanitiseShortText(body.tournamentName) ?? "FIFA WC 2026",
    champion: sanitiseChampion(body.champion),
    runnerUp: sanitiseChampion(body.runnerUp),
    thirdPlace: sanitiseChampion(body.thirdPlace),
    knockoutPath: sanitisePath(body.knockoutPath),
  };

  try {
    const png = await renderMoleculeCaptureCard(input);
    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="tournamental-molecule.png"`,
        // Capture is per-pose, do not cache. docs/22-deployment-and-tunnels.md.
        "cache-control": "no-store",
        "x-vtorn-capture-size": size,
      },
    });
  } catch (err) {
    return jsonError(
      500,
      "compose_failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------------
// Input sanitisation
// ---------------------------------------------------------------------------

const STAGES: ReadonlySet<MoleculeCapturePathEntry["stage"]> = new Set([
  "r16",
  "qf",
  "sf",
  "tp",
  "final",
]);

function sanitiseHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 32);
  if (!/^[a-zA-Z0-9._-]{1,32}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitiseShortText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, 48);
  return t.length > 0 ? t : null;
}

function sanitiseChampion(raw: unknown): MoleculeCaptureChampion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code.trim().toUpperCase() : null;
  if (!code || !/^[A-Z]{2,4}$/.test(code)) return null;
  const name =
    typeof r.name === "string" ? r.name.slice(0, 40) : code;
  let kit: { primary: string | null } | null = null;
  if (r.kit && typeof r.kit === "object") {
    const kr = r.kit as Record<string, unknown>;
    const primary =
      typeof kr.primary === "string" && /^#[0-9a-fA-F]{3,8}$/.test(kr.primary)
        ? kr.primary
        : null;
    kit = { primary };
  }
  return { code, name, kit };
}

function sanitisePath(raw: unknown): ReadonlyArray<MoleculeCapturePathEntry> {
  if (!Array.isArray(raw)) return [];
  const out: MoleculeCapturePathEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const stage =
      typeof e.stage === "string" ? e.stage.trim().toLowerCase() : null;
    const teamCode =
      typeof e.teamCode === "string" ? e.teamCode.trim().toUpperCase() : null;
    const teamName =
      typeof e.teamName === "string" ? e.teamName.slice(0, 40) : null;
    if (!stage || !STAGES.has(stage as MoleculeCapturePathEntry["stage"])) continue;
    if (!teamCode || !/^[A-Z]{2,4}$/.test(teamCode)) continue;
    out.push({
      stage: stage as MoleculeCapturePathEntry["stage"],
      teamCode,
      teamName: teamName ?? teamCode,
    });
    if (out.length >= 8) break; // hard cap on path length
  }
  return out;
}

function jsonError(status: number, code: string, detail: string): Response {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
