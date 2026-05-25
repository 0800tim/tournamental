/**
 * POST /api/v1/profile/avatar
 *
 * Filesystem-backed avatar upload. Stores an 800×800 JPEG @ 80% to
 * `apps/web/data/avatars/<userId>.jpg` keyed on the authenticated
 * user (served by app/avatars/[filename]/route.ts). The URL is
 * deterministic: `/avatars/<userId>.jpg` works as
 * long as the file exists, and clients fall back to a silhouette
 * when a 404 happens (share card, syndicate UI, etc.).
 *
 * Tim 2026-05-14: clients resize + JPEG-encode in-browser before
 * upload (see `components/profile/AvatarCropperModal.tsx`), so the
 * server only ever sees ~30-120 KB. We still run sharp on the way
 * in to enforce the canonical 800×800 / 80% target - a malicious
 * client could otherwise upload a 12 MB JPEG and waste disk.
 *
 *   - Auth required: tnm_session cookie. 401 otherwise.
 *   - Body: multipart/form-data with a `file` field.
 *   - Validation: jpeg/png/webp/gif, hard cap 12 MiB (well above the
 *     client-side resize target so we never reject a legitimate
 *     upload; just a guardrail against abuse).
 *   - Output: square-cropped, 800×800 JPEG @ quality 80. Deterministic
 *     filename means the second upload OVERWRITES the first.
 *
 * DELETE removes the file so the user can revert to the default
 * silhouette.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { NextRequest } from "next/server";
import sharp from "sharp";

import { getSessionFromRequest } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Must match the serve route (app/avatars/[filename]/route.ts), which
// reads from `data/avatars`. Next caches public/ at startup, so a file
// written there at runtime is silently 404'd -- the serve handler reads
// `data/avatars` from disk per request instead. (Tim 2026-05-25: the two
// routes had drifted -- uploads went to public/, serving read data/, so
// every uploaded avatar 404'd.)
const AVATAR_DIR = join(process.cwd(), "data", "avatars");
// Generous cap - clients resize to 800×800 JPEG @ 80% before uploading,
// so legitimate requests sit well under 1 MB. The 12 MiB ceiling
// guards against a malicious upload that bypasses the client.
const MAX_BYTES = 12 * 1024 * 1024;
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
      .resize(800, 800, { fit: "cover", position: "centre" })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    return jsonResponse({ error: "image_decode_failed" }, 400);
  }

  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const filename = `${userId}.jpg`;
  await fs.writeFile(join(AVATAR_DIR, filename), resized);

  // Clean up any older webp from the previous filename convention so
  // we don't serve a stale image when clients probe the legacy path.
  const legacyWebp = join(AVATAR_DIR, `${userId}.webp`);
  fs.unlink(legacyWebp).catch(() => {
    /* file didn't exist - fine */
  });

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

  // Remove both the current (.jpg) and legacy (.webp) names so
  // re-uploading later doesn't accidentally surface a stale webp.
  await Promise.allSettled([
    fs.unlink(join(AVATAR_DIR, `${userId}.jpg`)),
    fs.unlink(join(AVATAR_DIR, `${userId}.webp`)),
  ]);
  return jsonResponse({ ok: true }, 200);
}
