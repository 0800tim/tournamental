/**
 * `ShareButtons` — one-tap deep-link grid + native share + copy +
 * download. Listed as 9 explicit targets (mission spec). The Native
 * Share button is only rendered when `navigator.share` is available.
 *
 * Every interaction fires a `POST /v1/analytics/share` so the viral
 * loop can be measured. The fetch is fire-and-forget (`keepalive: true`)
 * so it doesn't slow the navigation.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { SHARE_TARGETS, type ShareTargetCtx, type ShareTargetId } from "./share-targets";

export interface ShareButtonsProps {
  readonly bracketId: string;
  /** Absolute share-page URL. */
  readonly url: string;
  /** Pre-formatted caption (auto-includes the URL). */
  readonly text: string;
  /** Short subject used by email + Reddit. */
  readonly subject: string;
  /** Absolute URL of the OG PNG (used by the Download button). */
  readonly pngUrl: string;
  /** Optional callback fired after every share action. */
  readonly onShare?: (target: ShareTargetId) => void;
}

const TRACK_ENDPOINT = "/api/analytics/share";

function track(bracketId: string, target: ShareTargetId): void {
  if (typeof window === "undefined") return;
  try {
    void fetch(TRACK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bracketId, target, ts: Date.now() }),
      keepalive: true,
    });
  } catch {
    // never throw from a share action
  }
}

export function ShareButtons(props: ShareButtonsProps) {
  const { bracketId, url, text, subject, pngUrl, onShare } = props;
  const [copied, setCopied] = useState(false);
  const [hasNativeShare, setHasNativeShare] = useState(false);

  useEffect(() => {
    setHasNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  const fireShare = useCallback(
    (id: ShareTargetId) => {
      track(bracketId, id);
      onShare?.(id);
    },
    [bracketId, onShare],
  );

  const handleNativeShare = useCallback(async () => {
    if (typeof navigator === "undefined" || !("share" in navigator)) return;
    try {
      await navigator.share({ title: subject, text, url });
      fireShare("native");
    } catch {
      // user cancelled — not an error
    }
  }, [subject, text, url, fireShare]);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else if (typeof window !== "undefined") {
        // Legacy fallback for very old browsers.
        const ta = window.document.createElement("textarea");
        ta.value = url;
        window.document.body.appendChild(ta);
        ta.select();
        // execCommand is deprecated but is still the only synchronous
        // clipboard primitive that works in older / non-secure contexts.
        // Cast through a typed helper to avoid `any`.
        const legacyCopy = (
          window.document as unknown as { execCommand: (c: string) => boolean }
        ).execCommand;
        legacyCopy("copy");
        window.document.body.removeChild(ta);
      }
      setCopied(true);
      fireShare("copy");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent
    }
  }, [url, fireShare]);

  const handleDownload = useCallback(async () => {
    try {
      const res = await fetch(pngUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = objectUrl;
      a.download = `vtourn-bracket-${bracketId}.png`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      fireShare("download");
    } catch {
      // Open in a new tab as a hard fallback.
      window.open(pngUrl, "_blank", "noopener,noreferrer");
    }
  }, [pngUrl, bracketId, fireShare]);

  const ctx: ShareTargetCtx = { url, text, subject };

  return (
    <div
      className="vt-share-buttons"
      data-testid="share-buttons"
      role="group"
      aria-label="Share to network"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
        gap: 10,
      }}
    >
      {hasNativeShare ? (
        <button
          type="button"
          onClick={handleNativeShare}
          data-share-target="native"
          data-testid="share-btn-native"
          aria-label="Share via system share sheet"
          className="vt-share-btn"
        >
          <span className="vt-share-icon" aria-hidden="true">
            ↗
          </span>
          <span className="vt-share-label">Share</span>
        </button>
      ) : null}

      {SHARE_TARGETS.map((target) => {
        if (target.id === "copy") {
          return (
            <button
              key="copy"
              type="button"
              onClick={handleCopy}
              data-share-target="copy"
              data-testid="share-btn-copy"
              aria-label={copied ? "Link copied to clipboard" : "Copy link"}
              className="vt-share-btn"
            >
              <span className="vt-share-icon" aria-hidden="true">
                {copied ? "✓" : "🔗"}
              </span>
              <span className="vt-share-label">{copied ? "Copied!" : "Copy link"}</span>
            </button>
          );
        }
        if (target.id === "download") {
          return (
            <button
              key="download"
              type="button"
              onClick={handleDownload}
              data-share-target="download"
              data-testid="share-btn-download"
              aria-label="Download share image as PNG"
              className="vt-share-btn"
            >
              <span className="vt-share-icon" aria-hidden="true">
                ⬇
              </span>
              <span className="vt-share-label">Download PNG</span>
            </button>
          );
        }
        const href = target.buildUrl(ctx);
        return (
          <a
            key={target.id}
            href={href}
            target={target.newTab ? "_blank" : undefined}
            rel={target.newTab ? "noopener noreferrer" : undefined}
            onClick={() => fireShare(target.id)}
            data-share-target={target.id}
            data-testid={`share-btn-${target.id}`}
            aria-label={`Share on ${target.label}`}
            className="vt-share-btn"
          >
            <span className="vt-share-icon" aria-hidden="true">
              {iconFor(target.id)}
            </span>
            <span className="vt-share-label">{target.label}</span>
          </a>
        );
      })}

      {copied ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="share-toast"
          className="vt-share-toast"
        >
          Copied!
        </div>
      ) : null}
    </div>
  );
}

function iconFor(id: ShareTargetId): string {
  switch (id) {
    case "whatsapp":
      return "💬";
    case "telegram":
      return "✈";
    case "twitter":
      return "𝕏";
    case "facebook":
      return "f";
    case "linkedin":
      return "in";
    case "reddit":
      return "®";
    case "email":
      return "✉";
    default:
      return "•";
  }
}
