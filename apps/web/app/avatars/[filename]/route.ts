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
 */

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

export async function GET(
  _req: Request,
  { params }: { params: { filename: string } },
): Promise<Response> {
  const filename = (params.filename ?? "").trim();
  if (!FILENAME_RE.test(filename)) return notFound();
  // Defence-in-depth: ensure the resolved path stays inside the dir.
  const candidate = normalize(join(AVATAR_DIR, filename));
  if (!candidate.startsWith(AVATAR_DIR)) return notFound();

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(candidate);
  } catch {
    return notFound();
  }

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Cache-Control":
        "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

export async function HEAD(
  req: Request,
  args: { params: { filename: string } },
): Promise<Response> {
  // Re-use the GET path so the file-existence check is identical;
  // strip the body before returning.
  const res = await GET(req, args);
  return new Response(null, { status: res.status, headers: res.headers });
}
