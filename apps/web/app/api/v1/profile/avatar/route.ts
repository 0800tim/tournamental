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
import { purgeCloudflare } from "@/lib/cloudflare/purge";

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
// SEC-PII-02 / SEC-PII-05: drop image/gif. The renderer doesn't show
// animated avatars anyway, and a malicious GIF (one tiny frame + a
// massive logical canvas) is a classic decompression bomb. JPEG + PNG
// + WebP still cover every legitimate upload path.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * SEC-PII-05: byte-level magic-number sniff so a renamed `.exe` can't
 * sneak past the MIME check. Returns the canonical mime for files we
 * accept, null otherwise.
 */
function sniffImageMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

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
  // SEC-PII-02: a missing `file.type` is now a hard reject — the
  // earlier `file.type &&` guard let an empty mime sail through to
  // sharp, which would then have to guess the format.
  if (!file.type || !ALLOWED_TYPES.has(file.type)) {
    return jsonResponse({ error: "unsupported_type", got: file.type ?? "" }, 415);
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // SEC-PII-05: confirm the actual bytes match an allowed image
  // signature before passing to sharp. A renamed `.exe` with
  // `Content-Type: image/png` would otherwise reach the decoder; this
  // is also the layer that would catch a GIF that somehow advertised
  // itself as a PNG.
  const sniffed = sniffImageMime(buf);
  if (!sniffed) {
    return jsonResponse({ error: "image_decode_failed" }, 400);
  }
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

  // Fire-and-forget Cloudflare edge purge so other visitors don't see
  // a stale avatar. The route serves with short max-age + ETag now, so
  // worst-case staleness without the purge is ~60s on a browser cache
  // and however long CF keeps the response (which respects max-age=60
  // too, so also ~60s). The purge collapses that to "instant".
  void purgeCloudflare([`/avatars/${filename}`]);

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
  // Purge edge so the removed avatar is gone for everyone (matches the
  // POST behaviour above).
  void purgeCloudflare([
    `/avatars/${userId}.jpg`,
    `/avatars/${userId}.webp`,
  ]);
  return jsonResponse({ ok: true }, 200);
}
