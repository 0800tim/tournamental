"use client";

/**
 * AvatarUploader — file-input + preview + POST to /api/v1/profile/avatar.
 *
 * The avatar URL is deterministic per user (`/avatars/<userId>.webp`)
 * so on success we just bust the cache with a `?v=<ts>` query and let
 * the rest of the UI re-render against the new URL.
 *
 * Why a query-string buster rather than a hash filename: the user's
 * own profile is the only thing that needs to see the freshly-uploaded
 * image immediately. Everything else (the share card, syndicate
 * member tiles, leaderboards) is fine being a few minutes stale —
 * the URL stays stable so Cloudflare can long-cache the bytes.
 */

import { useEffect, useRef, useState } from "react";

import { avatarUrlFor, DEFAULT_AVATAR_DATA_URI } from "@/lib/profile/avatar";

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

  const currentUrl = version > 0 ? `${avatarUrlFor(userId)}?v=${version}` : null;

  const handlePick = (): void => {
    inputRef.current?.click();
  };

  const handleFile = async (file: File): Promise<void> => {
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
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
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        {err && <span className="vt-avatar-uploader-err">{err}</span>}
        {busy && <span className="vt-avatar-uploader-status">Uploading…</span>}
      </div>
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
