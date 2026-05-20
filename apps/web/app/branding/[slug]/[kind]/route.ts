/**
 * GET /branding/<slug>/<kind>.webp
 *
 * Serves owner-uploaded syndicate branding (logo, hero) from
 * `apps/web/data/branding/<slug>/<kind>.webp`. Mirrors the avatar
 * route's design — we read from disk on every request because
 * Next prod caches the `public/` dir at startup, so files added at
 * runtime (uploads) are silently 404'd from there.
 *
 * Cache: `public, max-age=86400, stale-while-revalidate=604800`. The
 * URL is stable per (slug, kind); clients add `?v=<ts>` to bust the
 * edge cache after an upload.
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
  _req: Request,
  { params }: { params: { slug: string; kind: string } },
): Promise<Response> {
  const slug = (params.slug ?? "").trim();
  const kindFile = (params.kind ?? "").trim();
  if (!SLUG_RE.test(slug)) return notFound();
  if (!KIND_RE.test(kindFile)) return notFound();

  const candidate = normalize(join(BRANDING_DIR, slug, kindFile));
  if (!candidate.startsWith(BRANDING_DIR)) return notFound();

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(candidate);
  } catch {
    return notFound();
  }

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
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
