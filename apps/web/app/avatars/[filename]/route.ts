/**
 * GET /avatars/<userId>.jpg
 *
 * Serves user avatars from `data/avatars/` on the local filesystem.
 *
 * Why a route handler instead of dropping the file in `public/`:
 * Next.js prod (`next start`) caches the public/ directory at startup;
 * files added at runtime (which is exactly the avatar upload case)
 * are silently 404'd. Routing through a handler reads from disk on
 * every request, so a fresh upload is visible immediately.
 *
 * Caching: `public, max-age=86400, stale-while-revalidate=604800`.
 * Cloudflare absorbs reads heavily; the URL is stable per user (no
 * fingerprint) so re-uploads race the edge cache for ~1 day before
 * propagating. Clients that need an instant refresh after a save
 * already bust the cache with `?v=<ts>` in the link.
 *
 * Security: the filename is validated against the avatar shape
 * (auth user id + `.jpg` extension). Anything else returns 404 so
 * a `../etc/passwd` traversal attempt never reaches the fs.
 *
 * Missing-file handling (Tim 2026-06-04): the default response for a
 * non-existent avatar is a 200 SVG placeholder, not a 404. This kills
 * the dev-overlay + browser-console noise the Next 15 upgrade exposed
 * (every page with the bottom nav was logging a 404 per logged-in
 * user without an uploaded photo). The placeholder honours an
 * optional `?initial=<letter>` query param so AvatarImage / AuthChip
 * can render a proper initial circle; without it the SVG shows a
 * generic silhouette. Callers that NEED the 404 signal (e.g. the
 * BracketSavePanel probe that decides whether to show an "Upload"
 * empty state) can pass `?strict=1` to opt back in to the legacy
 * 404 behaviour.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, normalize } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVATAR_DIR = join(process.cwd(), "data", "avatars");
const FILENAME_RE = /^[a-zA-Z0-9_-]{4,128}\.jpg$/;

function notFound(): Response {
  return new Response("", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

// Deterministic pastel-ish HSL colour from the filename, so the same
// user always sees the same placeholder colour.
function colourFor(seed: string): string {
  const hash = createHash("sha1").update(seed).digest();
  const hue = hash[0] * 360 / 256;
  return `hsl(${hue.toFixed(0)} 55% 45%)`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function placeholderSvg(seed: string, initial: string | null): string {
  const bg = colourFor(seed);
  // Strip to a single visible glyph; fall back to a dot if nothing usable
  // (avoids a giant emoji or a multi-codepoint script spilling out of the
  // viewBox). Uppercased for the typographic convention; SVG renders
  // whatever code-point it's given, so any locale's first letter works.
  const raw = (initial ?? "").trim();
  const letter = raw.length > 0 ? Array.from(raw)[0]!.toUpperCase() : "·";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" fill="${bg}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="32" font-weight="600" fill="#ffffff">${escapeXml(letter)}</text>
</svg>`;
}

function placeholderResponse(seed: string, initial: string | null): Response {
  const svg = placeholderSvg(seed, initial);
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Short cache: as soon as the user uploads a real photo the URL
      // is shared with the JPEG response, so we don't want the SVG
      // placeholder pinned at the edge for long. 60s matches the JPEG
      // path's max-age so a successful upload propagates quickly.
      "Cache-Control": "public, max-age=60, must-revalidate",
      "X-Avatar-Source": "placeholder",
    },
  });
}

export async function GET(req: Request, props: { params: Promise<{ filename: string }> }): Promise<Response> {
  const params = await props.params;
  const filename = (params.filename ?? "").trim();
  if (!FILENAME_RE.test(filename)) return notFound();
  // Defence-in-depth: ensure the resolved path stays inside the dir.
  const candidate = normalize(join(AVATAR_DIR, filename));
  if (!candidate.startsWith(AVATAR_DIR)) return notFound();

  const url = new URL(req.url);
  const strict = url.searchParams.get("strict") === "1";
  const initial = url.searchParams.get("initial");

  let bytes: Buffer;
  let mtimeMs: number;
  try {
    const stat = await fs.stat(candidate);
    mtimeMs = stat.mtimeMs;
    bytes = await fs.readFile(candidate);
  } catch {
    // File missing: in strict mode, preserve the legacy 404 signal
    // (used by BracketSavePanel.tsx to decide whether to render the
    // "Upload a profile photo" empty state). Otherwise serve a 200
    // SVG placeholder so the browser doesn't log the request as an
    // error and the Next 15 dev overlay stays quiet.
    if (strict) return notFound();
    return placeholderResponse(filename, initial);
  }

  // Strong ETag from file mtime + size. Cheap and changes the moment a
  // new upload lands. Combined with `must-revalidate` this lets the
  // browser short-circuit to a 304 on unchanged content (saves the
  // JPEG bytes on the wire) but always asks the origin, so the user
  // sees a new upload immediately — no manual cache flush required.
  // Tim 2026-06-03: this used to be `max-age=86400 stale-while-revalidate=604800`
  // which meant the browser held the old avatar for 24h after upload.
  const etag = `W/"${Math.floor(mtimeMs)}-${bytes.length}"`;
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "public, max-age=60, must-revalidate",
      },
    });
  }

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=60, must-revalidate",
      ETag: etag,
      "Last-Modified": new Date(mtimeMs).toUTCString(),
    },
  });
}

export async function HEAD(
  req: Request,
  args: { params: Promise<{ filename: string }> },
): Promise<Response> {
  // Re-use the GET path so the file-existence check is identical;
  // strip the body before returning. GET also accepts the Promise-typed
  // `args.params` (Next 15 async dynamic API), so passing through is safe.
  const res = await GET(req, args);
  return new Response(null, { status: res.status, headers: res.headers });
}
