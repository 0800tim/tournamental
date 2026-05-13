"use client";

/**
 * AvatarUploader — file-input + cropper modal + POST to /api/v1/profile/avatar.
 *
 * Flow:
 *   1. User clicks "Upload avatar" → native file picker.
 *   2. We read the picked file into an object URL and open the
 *      Facebook-style cropper modal (zoom + drag inside a circular
 *      crop frame; output is a square PNG).
 *   3. On accept, we POST the cropped Blob to /api/v1/profile/avatar.
 *      The server resizes to 256×256 webp and returns the new URL.
 *   4. Bust the avatar URL with `?v=<ts>` so the preview rerenders.
 *
 * The avatar URL is deterministic per user (`/avatars/<userId>.jpg`)
 * so we just bust the cache with a `?v=<ts>` query and let the rest
 * of the UI re-render against the new URL.
 */

import { useEffect, useRef, useState } from "react";

import { avatarUrlFor, DEFAULT_AVATAR_DATA_URI } from "@/lib/profile/avatar";
import { AvatarCropperModal } from "./AvatarCropperModal";

export interface AvatarUploaderProps {
  readonly userId: string;
  /** Optional callback fired when the avatar URL changes (after upload
   *  or delete). Receives the URL or null when removed. */
  readonly onChange?: (url: string | null) => void;
}

export function AvatarUploader({ userId, onChange }: AvatarUploaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);

  // Initial probe: does an avatar exist on disk? If yes, the version
  // bumps so the <img> shows it; if no, we keep the silhouette.
  useEffect(() => {
    let cancelled = false;
    void fetch(avatarUrlFor(userId), { method: "HEAD", cache: "no-store" }).then((r) => {
      if (cancelled) return;
      if (r.ok) setVersion(1);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Always revoke the previous crop-stage object URL when a new file
  // is picked or the modal is dismissed; the browser pins the underlying
  // bytes until we call `URL.revokeObjectURL`.
  useEffect(() => {
    return () => {
      if (cropImageUrl) {
        try {
          URL.revokeObjectURL(cropImageUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [cropImageUrl]);

  const currentUrl = version > 0 ? `${avatarUrlFor(userId)}?v=${version}` : null;

  const handlePick = (): void => {
    inputRef.current?.click();
  };

  const handlePicked = (file: File): void => {
    setErr(null);
    // No size cap on the picked file — the cropper resizes everything
    // to 800×800 JPEG @ 80% in-browser before upload, so even a 30 MB
    // RAW from someone's phone arrives at the server as ~80 KB.
    const url = URL.createObjectURL(file);
    setCropImageUrl(url);
  };

  const handleCropAccept = async (blob: Blob): Promise<void> => {
    setCropImageUrl(null);
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
    try {
      const res = await fetch("/api/v1/profile/avatar", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(humaniseAvatarError(body.error ?? `HTTP ${res.status}`));
        return;
      }
      const next = Date.now();
      setVersion(next);
      onChange?.(`${avatarUrlFor(userId)}?v=${next}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v1/profile/avatar", {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setVersion(0);
        onChange?.(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vt-avatar-uploader">
      <div
        className="vt-avatar-uploader-preview"
        role="img"
        aria-label={currentUrl ? "Your avatar" : "Default avatar silhouette"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentUrl ?? DEFAULT_AVATAR_DATA_URI}
          alt=""
          width={96}
          height={96}
        />
      </div>
      <div className="vt-avatar-uploader-controls">
        <button
          type="button"
          className="vt-avatar-uploader-btn"
          onClick={handlePick}
          disabled={busy}
        >
          {currentUrl ? "Change avatar" : "Upload avatar"}
        </button>
        {currentUrl && (
          <button
            type="button"
            className="vt-avatar-uploader-btn vt-avatar-uploader-btn-ghost"
            onClick={() => void handleRemove()}
            disabled={busy}
          >
            Remove
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handlePicked(f);
            e.target.value = "";
          }}
        />
        {err && <span className="vt-avatar-uploader-err">{err}</span>}
        {busy && <span className="vt-avatar-uploader-status">Uploading…</span>}
      </div>

      <AvatarCropperModal
        imageUrl={cropImageUrl}
        onAccept={(blob) => void handleCropAccept(blob)}
        onCancel={() => setCropImageUrl(null)}
      />
    </div>
  );
}

function humaniseAvatarError(code: string): string {
  switch (code) {
    case "unauthorised":
      return "Sign in to upload an avatar.";
    case "file_too_large":
      return "Avatar must be 5 MB or smaller.";
    case "unsupported_type":
      return "Use JPG, PNG, WebP, or GIF.";
    case "image_decode_failed":
      return "Couldn't read that image — try a different file.";
    default:
      return code;
  }
}
