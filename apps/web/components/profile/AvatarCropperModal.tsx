"use client";

/**
 * AvatarCropperModal — Facebook-style profile-photo cropper.
 *
 * After the user picks a file we open this modal: image inside a
 * circular crop frame, zoom slider, free-drag positioning. Output is
 * a square (1:1) PNG Blob at the user's selected zoom/pan; the
 * server resizes to 256×256 webp on upload, but cropping client-side
 * lets the user choose what gets framed before the irreversible
 * server-side crop runs.
 *
 * Implementation uses `react-easy-crop` (3 KB gzipped, no peer deps
 * beyond React). The circular aspect is purely visual — the actual
 * crop output is square (`cropShape="round"` is for the on-screen
 * mask, not the output buffer), and our CSS rounds the avatar disc
 * everywhere it renders.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area, Point } from "react-easy-crop";

export interface AvatarCropperModalProps {
  /** Object URL or data URL of the picked file. Null when the modal is closed. */
  readonly imageUrl: string | null;
  /** Called when the user accepts the crop. The Blob is a square PNG. */
  readonly onAccept: (blob: Blob) => void;
  /** Called when the user dismisses without accepting. */
  readonly onCancel: () => void;
}

export function AvatarCropperModal({
  imageUrl,
  onAccept,
  onCancel,
}: AvatarCropperModalProps): JSX.Element | null {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state whenever a new image opens the modal.
  useEffect(() => {
    if (imageUrl) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    }
  }, [imageUrl]);

  // Esc to dismiss; focus the dialog so the keystroke is captured even
  // when the user hasn't clicked into anything yet.
  useEffect(() => {
    if (!imageUrl) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageUrl, onCancel]);

  const onCropComplete = useCallback((_area: Area, areaPx: Area) => {
    setCroppedAreaPixels(areaPx);
  }, []);

  const handleAccept = useCallback(async (): Promise<void> => {
    if (!imageUrl || !croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await cropToBlob(imageUrl, croppedAreaPixels);
      onAccept(blob);
    } finally {
      setBusy(false);
    }
  }, [imageUrl, croppedAreaPixels, onAccept]);

  if (!imageUrl) return null;

  return (
    <div
      className="vt-avatar-crop-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Crop your avatar"
      onClick={onCancel}
    >
      <div
        className="vt-avatar-crop-dialog"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vt-avatar-crop-head">
          <h2 className="vt-avatar-crop-title">Crop your avatar</h2>
          <p className="vt-avatar-crop-sub">
            Drag to reposition. Use the slider to zoom. We&apos;ll crop the
            framed area and round the corners.
          </p>
        </header>

        <div className="vt-avatar-crop-stage">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="contain"
            restrictPosition
            style={{
              containerStyle: { background: "#0a0e1a" },
              cropAreaStyle: {
                color: "rgba(10, 14, 26, 0.6)",
                border: "2px solid rgba(251, 191, 36, 0.85)",
              },
            }}
          />
        </div>

        <div className="vt-avatar-crop-controls">
          <label className="vt-avatar-crop-zoom">
            <span aria-hidden="true">−</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
            />
            <span aria-hidden="true">+</span>
          </label>
        </div>

        <footer className="vt-avatar-crop-foot">
          <button
            type="button"
            className="vt-avatar-uploader-btn vt-avatar-uploader-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="vt-avatar-uploader-btn"
            onClick={() => void handleAccept()}
            disabled={busy || !croppedAreaPixels}
          >
            {busy ? "Saving…" : "Save avatar"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Crop the source image at the pixel-space rect produced by
 * react-easy-crop, returning an 800×800 JPEG Blob at 80% quality.
 *
 * Sizing decision (Tim 2026-05-14): doing the resize entirely in the
 * browser keeps the upload tiny (typically 30–120 KB) regardless of
 * source-file size, so users can drop in a 30 MB phone RAW and we
 * still hand the server a friendly buffer. 800×800 is plenty for the
 * highest-DPR retina avatar render at 96px on screen.
 */
async function cropToBlob(imageUrl: string, area: Area): Promise<Blob> {
  const img = await loadImage(imageUrl);
  const OUTPUT = 800;
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT;
  canvas.height = OUTPUT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  // High-quality downscale: enable smoothing + tell the browser to
  // prioritise quality over speed on the resize step.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // JPEG can't represent transparency; fill with a neutral background
  // first so any alpha pixels in the source flatten predictably.
  ctx.fillStyle = "#0a0e1a";
  ctx.fillRect(0, 0, OUTPUT, OUTPUT);
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT,
    OUTPUT,
  );
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.8,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
