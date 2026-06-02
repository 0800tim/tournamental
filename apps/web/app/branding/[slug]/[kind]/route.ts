/**
 * GET /branding/<slug>/<kind>.webp
 *
 * Serves owner-uploaded syndicate branding (logo, hero) from
 * `apps/web/data/branding/<slug>/<kind>.webp`. Mirrors the avatar
 * route's design — we read from disk on every request because
 * Next prod caches the `public/` dir at startup, so files added at
 * runtime (uploads) are silently 404'd from there.
 *
 * Cache: `public, max-age=60, must-revalidate` + a strong ETag from
 * the file mtime. Browsers revalidate (cheap 304) on every navigation
 * after the first minute, so an owner's logo / hero upload is visible
 * to other visitors within 60s at the absolute outside — and instantly
 * if the upload route also Cloudflare-purges the URL (which it does).
 * Tim 2026-06-03: previously `max-age=86400 stale-while-revalidate=604800`
 * meant new uploads took up to a day to propagate, and CF held the old
 * file for up to a week. Required a manual cache flush to fix.
 */

import { promises as fs } from "node:fs";
import { join, normalize } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRANDING_DIR = join(process.cwd(), "data", "branding");
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const KIND_RE = /^(logo|hero)\.webp$/;

function notFound(): Response {
  return new Response("", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: { slug: string; kind: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").trim();
  const kindFile = (params.kind ?? "").trim();
  if (!SLUG_RE.test(slug)) return notFound();
  if (!KIND_RE.test(kindFile)) return notFound();

  const candidate = normalize(join(BRANDING_DIR, slug, kindFile));
  if (!candidate.startsWith(BRANDING_DIR)) return notFound();

  let bytes: Buffer;
  let mtimeMs: number;
  try {
    const stat = await fs.stat(candidate);
    mtimeMs = stat.mtimeMs;
    bytes = await fs.readFile(candidate);
  } catch {
    return notFound();
  }

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
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=60, must-revalidate",
      ETag: etag,
      "Last-Modified": new Date(mtimeMs).toUTCString(),
    },
  });
}

export async function HEAD(
  req: Request,
  args: { params: { slug: string; kind: string } },
): Promise<Response> {
  const res = await GET(req, args);
  return new Response(null, { status: res.status, headers: res.headers });
}
