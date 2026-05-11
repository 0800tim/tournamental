"use client";

/**
 * MoleculeCaptureButton — floating "capture & share" affordance.
 *
 * Sits in the top-right corner of the molecule canvas pane (clear of
 * the app-bar hamburger and the existing PATH TO GOLD chip at top-
 * centre). Default state is visible-but-unobtrusive; on hover/touch
 * the button expands to surface its label.
 *
 * Click flow:
 *   1. Grab the WebGL canvas PNG at the user's current pose.
 *   2. POST it to /api/share/molecule-capture, the server overlays the
 *      prediction card (champion + path-to-gold + handle + QR + wordmark)
 *      and returns the composed PNG.
 *   3. Hand the PNG to navigator.share (with `files`) on capable mobile
 *      browsers; fall back to <a download> + clipboard copy on desktop.
 *   4. Fire the `molecule.capture.shared` analytics event with the
 *      outcome so we can measure share rate per pose.
 *
 * Stateless DOM lookup; the component never holds a ref to the R3F
 * canvas, it just queries `.molecule-canvas` via a tiny lib helper.
 * That means it can be dropped anywhere inside the molecule page
 * without prop-drilling the scene's internals.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { track } from "@/lib/analytics";
import {
  shareCapture,
  type CaptureInput,
  type CaptureResult,
  type ShareOutcome,
} from "@/lib/molecule/capture";
import { captureDomComposition } from "@/lib/molecule/dom-capture";

import "./molecule-capture.css";

export interface MoleculeCaptureButtonProps {
  /** Resolved share guid for the user's bracket; drives the URL + QR. */
  readonly shareGuid: string;
  /** Optional display handle. Surfaces as "@handle" on the card. */
  readonly handle?: string | null;
  /** Champion + (optional) silver/bronze + path summary for the overlay. */
  readonly input: Omit<CaptureInput, "shareGuid" | "handle">;
  /** Hide the button (e.g. while the bracket is empty / no champion). */
  readonly hidden?: boolean;
}

type Status = "idle" | "capturing" | "sharing" | "done" | "error";

const SHARE_TITLE = "My Tournamental World Cup 2026 molecule";
const SHARE_TEXT_BASE = "Here's my World Cup 2026 prediction molecule on Tournamental";

export function MoleculeCaptureButton({
  shareGuid,
  handle,
  input,
  hidden,
}: MoleculeCaptureButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // We keep the latest object URL so we can revoke it on the next click
  // (or unmount), the browser will hold the blob memory otherwise.
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) {
        try {
          URL.revokeObjectURL(lastUrlRef.current);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const onClick = useCallback(async () => {
    if (status === "capturing" || status === "sharing") return;
    setStatus("capturing");
    setErrMsg(null);
    let result: CaptureResult | null = null;
    let outcome: ShareOutcome | "error" = "error";
    const startedAt = Date.now();
    try {
      // v6, "viral share landing", compose the share image client-side
      // as a literal DOM screenshot of the pyramid + champion panel
      // rather than round-tripping to /api/share/molecule-capture
      // (which re-draws a server-rendered card). See dom-capture.ts.
      result = await captureDomComposition({
        shareGuid,
        handle,
        tournamentName: input.tournamentName,
        champion: input.champion,
        knockoutPath: input.knockoutPath,
      });
      // Revoke any previous capture's object URL.
      if (lastUrlRef.current) {
        try {
          URL.revokeObjectURL(lastUrlRef.current);
        } catch {
          // ignore
        }
      }
      lastUrlRef.current = result.objectUrl;

      setStatus("sharing");
      const shareUrl = `https://play.tournamental.com/s/${encodeURIComponent(shareGuid)}`;
      const championLabel = input.champion?.name ?? null;
      const text = championLabel
        ? `${SHARE_TEXT_BASE} — I've got ${championLabel} lifting the trophy. ${shareUrl}`
        : `${SHARE_TEXT_BASE}. ${shareUrl}`;
      outcome = await shareCapture({
        result,
        shareUrl,
        title: SHARE_TITLE,
        text,
      });
      setStatus("done");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setErrMsg(detail);
      setStatus("error");
      outcome = "error";
    } finally {
      track("molecule.capture.shared", {
        outcome,
        elapsed_ms: Date.now() - startedAt,
        has_champion: !!input.champion?.code,
        has_path: (input.knockoutPath ?? []).length > 0,
        share_guid_short: shareGuid.slice(0, 8),
        size: input.size ?? "landscape",
      });
    }
  }, [handle, input, shareGuid, status]);

  if (hidden) return null;

  const busy = status === "capturing" || status === "sharing";
  const label =
    status === "capturing"
      ? "Capturing…"
      : status === "sharing"
        ? "Sharing…"
        : status === "done"
          ? "Shared"
          : status === "error"
            ? "Try again"
            : "Share this view";

  return (
    <div className="molecule-capture-root" data-status={status}>
      <button
        type="button"
        className="molecule-capture-btn"
        onClick={onClick}
        disabled={busy}
        aria-label="Capture and share this molecule view"
        aria-busy={busy}
        title="Capture and share this molecule view"
      >
        <span className="molecule-capture-btn-icon" aria-hidden>
          {status === "done" ? "✓" : status === "error" ? "↻" : (
            // Inline camera SVG — ~340 bytes uncompressed, no extra request.
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              role="presentation"
            >
              <path
                d="M9 4l-1.5 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.5L15 4H9Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle
                cx="12"
                cy="13"
                r="3.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          )}
        </span>
        <span className="molecule-capture-btn-label">{label}</span>
      </button>
      {status === "error" && errMsg ? (
        <p className="molecule-capture-error" role="alert">
          Couldn&apos;t share that pose. {errMsg.slice(0, 80)}
        </p>
      ) : null}
      {status === "done" ? (
        <p className="molecule-capture-hint" role="status">
          PNG ready. Paste it into any chat.
        </p>
      ) : null}
    </div>
  );
}
