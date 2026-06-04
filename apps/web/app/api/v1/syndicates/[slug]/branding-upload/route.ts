/**
 * POST /api/v1/syndicates/[slug]/branding-upload?kind=logo|hero
 *
 * Owner-only image upload. Body is multipart/form-data with a `file`
 * field; the server resizes/re-encodes with sharp to a canonical size:
 *
 *   logo → 512×512 webp @ 85, fit:contain on transparent background
 *   hero → 1600×800 webp @ 80, fit:cover (centred crop)
 *
 * Output lands at `apps/web/data/branding/<slug>/<kind>.webp` and the
 * matching `branding_logo_url` / `branding_hero_url` column is updated
 * with `/branding/<slug>/<kind>.webp?v=<ts>`. The cache-buster makes
 * sure the preview reflects the new upload instantly.
 *
 * Clients should compress in-browser before upload (see
 * BrandingImageUploader), but we accept up to 12 MiB on the wire as
 * a guardrail against bypassed clients.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import sharp from "sharp";

import { getSessionFromRequest } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { getPersistence } from "@/lib/syndicate/persistence";
import { invalidateSyndicateOgCache } from "@/lib/og/syndicate-cache";
import { purgeCloudflare } from "@/lib/cloudflare/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRANDING_DIR = join(process.cwd(), "data", "branding");
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type Kind = "logo" | "hero";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function safeSlug(raw: string): string | null {
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(raw) ? raw : null;
}

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  const slug = safeSlug((params.slug ?? "").toLowerCase().trim());
  if (!slug) return json({ error: "bad_slug" }, 400);

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "") as Kind;
  if (kind !== "logo" && kind !== "hero") return json({ error: "bad_kind" }, 400);

  const session = await getSessionFromRequest(req);
  if (!session) return json({ error: "unauthorised" }, 401);

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json({ error: "not_found" }, 404);
  // SEC-WEB-06 / SEC-POOL-01: strict owner_user_id match only. The
  // legacy `owner_phone === session.phone` fallback is removed because
  // (a) it lets anyone who owns a number that happens to collide with
  // an old null-owner pool seize branding control and (b) every active
  // pool now has owner_user_id set (the create route binds it on every
  // path). Null-owner pools that pre-date that change must be backfilled
  // or use the manage-JWT path via /manage-auth instead.
  if (row.owner_user_id !== session.userId && !isSuperAdmin(session)) {
    return json({ error: "forbidden" }, 403);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "missing_file" }, 400);
  if (file.size > MAX_BYTES) {
    return json({ error: "file_too_large", max_bytes: MAX_BYTES }, 413);
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return json({ error: "unsupported_type", got: file.type }, 415);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let resized: Buffer;
  try {
    const pipeline = sharp(buf, { failOn: "error" }).rotate();
    // Detect alpha BEFORE we resize -- sharp's metadata() reads from the
    // original buffer cheaply and is the only honest signal of "did the
    // user upload a transparent logo". hasAlpha:true triggers lossless
    // webp instead of lossy q=85; lossy webp+alpha produced a checkered
    // halo around transparent regions on real-world logos (Tim
    // 2026-05-22). Output stays as .webp -- the asset-serving route is
    // keyed on the .webp extension and lossless webp is browser-native.
    const meta = await sharp(buf).metadata();
    const hasAlpha = !!meta.hasAlpha;
    resized =
      kind === "logo"
        ? await pipeline
            .resize(512, 512, {
              fit: "contain",
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp(hasAlpha ? { lossless: true } : { quality: 85 })
            .toBuffer()
        : await pipeline
            .resize(1600, 800, { fit: "cover", position: "centre" })
            .webp(hasAlpha ? { lossless: true } : { quality: 80 })
            .toBuffer();
  } catch {
    return json({ error: "image_decode_failed" }, 400);
  }

  const dir = join(BRANDING_DIR, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${kind}.webp`), resized);

  // Update the matching column. URL is stable per (slug, kind); a
  // cache-buster lives in the returned URL so the preview shows the
  // new file immediately.
  const stableUrl = `/branding/${slug}/${kind}.webp`;
  const column = kind === "logo" ? "branding_logo_url" : "branding_hero_url";
  try {
    persistence.db
      .prepare(`UPDATE syndicates SET ${column} = ? WHERE id = ?`)
      .run(stableUrl, row.id);
  } catch {
    /* non-fatal — file is saved, preview already works via URL */
  }

  // New logo / hero changes the rendered OG image -- pop the cache.
  void invalidateSyndicateOgCache(slug);

  // Fire-and-forget Cloudflare edge purge so the new logo / hero is
  // visible immediately to every visitor (not just the uploader, who
  // sees the `?v=<ts>` URL in the response above). Without this an
  // owner has to manually flush CF on every upload, which Tim hit
  // 2026-06-03 — see the cache-headers fix on the GET route too.
  void purgeCloudflare([stableUrl]);

  return json({
    ok: true,
    url: `${stableUrl}?v=${Date.now()}`,
    kind,
    bytes: resized.length,
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  const slug = safeSlug((params.slug ?? "").toLowerCase().trim());
  if (!slug) return json({ error: "bad_slug" }, 400);
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "") as Kind;
  if (kind !== "logo" && kind !== "hero") return json({ error: "bad_kind" }, 400);
  const session = await getSessionFromRequest(req);
  if (!session) return json({ error: "unauthorised" }, 401);

  const persistence = getPersistence();
  const row = persistence.getBySlug(slug);
  if (!row) return json({ error: "not_found" }, 404);
  // SEC-WEB-06 / SEC-POOL-01: strict owner_user_id match only. The
  // legacy `owner_phone === session.phone` fallback is removed because
  // (a) it lets anyone who owns a number that happens to collide with
  // an old null-owner pool seize branding control and (b) every active
  // pool now has owner_user_id set (the create route binds it on every
  // path). Null-owner pools that pre-date that change must be backfilled
  // or use the manage-JWT path via /manage-auth instead.
  if (row.owner_user_id !== session.userId && !isSuperAdmin(session)) {
    return json({ error: "forbidden" }, 403);
  }

  await fs.unlink(join(BRANDING_DIR, slug, `${kind}.webp`)).catch(() => {
    /* file didn't exist — fine */
  });
  const column = kind === "logo" ? "branding_logo_url" : "branding_hero_url";
  try {
    persistence.db.prepare(`UPDATE syndicates SET ${column} = NULL WHERE id = ?`).run(row.id);
  } catch {
    /* non-fatal */
  }
  // Purge edge so visitors don't keep seeing the removed image.
  void invalidateSyndicateOgCache(slug);
  void purgeCloudflare([`/branding/${slug}/${kind}.webp`]);
  return json({ ok: true });
}
