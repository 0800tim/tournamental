/**
 * POST /api/v1/profile/avatar
 *
 * Filesystem-backed avatar upload. Stores a 256×256 webp to
 * `apps/web/public/avatars/<userId>.webp` keyed on the authenticated
 * user. The URL is then deterministic: `/avatars/<userId>.webp` works
 * as long as the file exists, and clients can fall back to a default
 * silhouette if a 404 happens (the share card, syndicate UI, etc.).
 *
 * Cloudflare caches `/avatars/*` aggressively (Next static handler
 * serves with long max-age + immutable hash via filename; we don't
 * fingerprint per-version so a re-upload races CF, see DELETE below
 * for the invalidation path).
 *
 *   - Auth required: tnm_session cookie. 401 otherwise.
 *   - Body: multipart/form-data with a `file` field.
 *   - Validation: jpeg/png/webp/gif, max 5 MiB pre-resize.
 *   - Output: square-cropped, 256×256, webp quality 86. Deterministic
 *     filename means the second upload OVERWRITES the first.
 *
 * DELETE removes the file so the user can revert to the default
 * silhouette. The two methods are the only public ones; GET reads
 * straight from /avatars/<userId>.webp via the static handler so it's
 * not implemented here.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import sharp from "sharp";

import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVATAR_DIR = join(process.cwd(), "public", "avatars");
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function safeUserId(raw: string): string | null {
  // Allow uuid v4, auth-sms `u_<hex>`, supabase UUIDs. Reject anything
  // that could escape the avatars dir.
  return /^[a-zA-Z0-9_-]{4,128}$/.test(raw) ? raw : null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "unauthorised" }, 401);

  const userId = safeUserId(session.userId);
  if (!userId) return jsonResponse({ error: "bad_user_id" }, 400);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "invalid_form" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "missing_file" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return jsonResponse({ error: "file_too_large", max_bytes: MAX_BYTES }, 413);
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return jsonResponse({ error: "unsupported_type", got: file.type }, 415);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let resized: Buffer;
  try {
    resized = await sharp(buf, { failOn: "error" })
      .rotate() // honour EXIF orientation
      .resize(256, 256, { fit: "cover", position: "centre" })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    return jsonResponse({ error: "image_decode_failed" }, 400);
  }

  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const filename = `${userId}.webp`;
  await fs.writeFile(join(AVATAR_DIR, filename), resized);

  return jsonResponse(
    { ok: true, url: `/avatars/${filename}?v=${Date.now()}` },
    200,
  );
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "unauthorised" }, 401);
  const userId = safeUserId(session.userId);
  if (!userId) return jsonResponse({ error: "bad_user_id" }, 400);

  const filename = join(AVATAR_DIR, `${userId}.webp`);
  try {
    await fs.unlink(filename);
  } catch {
    // File already gone is fine.
  }
  return jsonResponse({ ok: true }, 200);
}
