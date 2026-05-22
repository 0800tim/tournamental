"use client";

/**
 * Logo / hero image uploader for the pool manage page.
 *
 * Mirrors AvatarUploader's behaviour: pick a file → in-browser canvas
 * resize → POST to /api/v1/syndicates/<slug>/branding-upload?kind=
 * The server still re-encodes via sharp (defence-in-depth) but the
 * client-side resize means even a 10 MB phone photo lands as ~80 KB
 * on the wire.
 *
 * The component is uncontrolled w.r.t. the saved URL — after a
 * successful upload it calls `onChange(newUrl)` so the parent can
 * update its draft state and the live preview can refresh.
 */

import { useEffect, useRef, useState } from "react";

export type BrandingKind = "logo" | "hero";

interface BrandingImageUploaderProps {
  readonly slug: string;
  readonly kind: BrandingKind;
  readonly currentUrl: string | null;
  readonly onChange: (newUrl: string | null) => void;
  readonly label: string;
  readonly hint?: string;
}

// Target sizes the client resizes to before upload. Server still
// enforces its own canonical size, so these are just bandwidth saves.
// Exported so the create-pool form can reuse them for its deferred
// (no-slug-yet) uploaders without forking the resize logic.
export const BRANDING_TARGETS: Record<BrandingKind, { width: number; height: number; quality: number }> = {
  logo: { width: 1024, height: 1024, quality: 0.85 },
  hero: { width: 1920, height: 960, quality: 0.82 },
};
const TARGETS = BRANDING_TARGETS;

export async function resizeToBlob(
  file: File,
  target: { width: number; height: number; quality: number },
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const ratio = Math.min(target.width / img.width, target.height / img.height, 1);
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas-context-failed");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", target.quality),
    );
    if (!blob) throw new Error("canvas-encode-failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load-failed"));
    img.src = src;
  });
}

export function BrandingImageUploader({
  slug,
  kind,
  currentUrl,
  onChange,
  label,
  hint,
}: BrandingImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Local preview URL (bust the server cache after a save).
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);

  useEffect(() => {
    setPreviewUrl(currentUrl);
  }, [currentUrl]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void upload(file);
  };

  const upload = async (file: File): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      const blob = await resizeToBlob(file, TARGETS[kind]);
      const form = new FormData();
      form.append("file", new File([blob], `${kind}.webp`, { type: "image/webp" }));
      const res = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/branding-upload?kind=${kind}`,
        { method: "POST", credentials: "include", body: form },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setErr(
          body.error === "forbidden"
            ? "You aren't the owner of this pool."
            : body.error === "unauthorised"
              ? "Sign in to update branding."
              : body.error === "file_too_large"
                ? "File too large (12 MB max)."
                : "Upload failed. Try a different file.",
        );
        return;
      }
      setPreviewUrl(body.url);
      onChange(body.url);
    } catch {
      setErr("Couldn't process this image. Try a different file.");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/branding-upload?kind=${kind}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        setErr("Couldn't remove the image.");
        return;
      }
      setPreviewUrl(null);
      onChange(null);
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const aspect = kind === "logo" ? "1 / 1" : "2 / 1";
  const maxW = kind === "logo" ? 120 : 320;

  return (
    <div className="vt-brand-field">
      <span className="vt-brand-label">{label}</span>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          style={{
            width: maxW,
            aspectRatio: aspect,
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt={`${kind} preview`}
              style={{ width: "100%", height: "100%", objectFit: kind === "logo" ? "contain" : "cover" }}
            />
          ) : (
            <span style={{ color: "var(--vt-fg-muted, #9aa6c2)", fontSize: 12 }}>
              No {kind}
            </span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={onPick}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Uploading…" : previewUrl ? `Replace ${kind}` : `Upload ${kind}`}
          </button>
          {previewUrl && (
            <button
              type="button"
              className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
              onClick={() => void onRemove()}
              disabled={busy}
              style={{ color: "#f87171" }}
            >
              Remove
            </button>
          )}
          {hint && (
            <span style={{ fontSize: 11, color: "var(--vt-fg-muted, #9aa6c2)", maxWidth: 220 }}>
              {hint}
            </span>
          )}
          {err && (
            <span style={{ fontSize: 12, color: "#f87171", maxWidth: 220 }}>{err}</span>
          )}
        </div>
      </div>
    </div>
  );
}
