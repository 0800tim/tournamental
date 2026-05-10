/**
 * `ShareModal` — the viral share sheet.
 *
 * Renders:
 *  - Server-rendered OG preview (`<ShareCard>`).
 *  - Pre-filled, editable caption.
 *  - One-tap deep-link grid (`<ShareButtons>`).
 *
 * Layout:
 *  - Mobile: full-width bottom sheet (CSS-only — no overlay manager
 *    dependency so the modal works from any page).
 *  - Desktop: centred card, max 640px wide.
 *
 * The modal is mounted via `<ShareModalProvider>` and opened with
 * `useShareModal().open(payload)`. The bracket page wires a "Share my
 * bracket" button to the hook.
 */

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildShareCaption,
  buildShareTitle,
  encodeBracketPayload,
  type BracketSharePayload,
} from "@/lib/share/payload";

import { ShareButtons } from "./ShareButtons";
import { ShareCard } from "./ShareCard";

export interface ShareModalProps {
  readonly open: boolean;
  readonly payload: BracketSharePayload | null;
  readonly onClose: () => void;
  /** Optional origin for share URLs — defaults to `window.location.origin`. */
  readonly origin?: string;
}

function buildUrls(payload: BracketSharePayload, originRaw: string) {
  const origin = originRaw.replace(/\/$/, "");
  const params = encodeBracketPayload(payload);
  const queryString = params.toString();
  const sharePath = `/share/${encodeURIComponent(payload.bracketId)}`;
  const pngPath = `/api/og/${encodeURIComponent(payload.bracketId)}`;
  return {
    shareUrl: `${origin}${sharePath}${queryString ? `?${queryString}` : ""}`,
    pngUrl: `${origin}${pngPath}${queryString ? `?${queryString}` : ""}`,
  };
}

export function ShareModal(props: ShareModalProps) {
  const { open, payload, onClose, origin } = props;
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const resolvedOrigin = useMemo(() => {
    if (origin) return origin;
    if (typeof window !== "undefined") return window.location.origin;
    return "https://vtourn.com";
  }, [origin]);

  const { shareUrl, pngUrl } = useMemo(() => {
    if (!payload) return { shareUrl: "", pngUrl: "" };
    return buildUrls(payload, resolvedOrigin);
  }, [payload, resolvedOrigin]);

  const initialCaption = useMemo(() => {
    if (!payload) return "";
    return buildShareCaption(payload, shareUrl);
  }, [payload, shareUrl]);

  const [caption, setCaption] = useState(initialCaption);
  // Reset caption when modal re-opens with a new payload.
  useEffect(() => {
    setCaption(initialCaption);
  }, [initialCaption]);

  // Esc-to-close + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Focus the dialog when it opens, for keyboard users.
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open || !payload) return null;

  const subject = buildShareTitle(payload);

  return (
    <div
      className="vt-share-backdrop"
      data-testid="share-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 8, 18, 0.78)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="vt-share-modal"
        data-testid="share-modal"
        style={{
          width: "100%",
          maxWidth: 640,
          background: "#0f172a",
          color: "#fff",
          borderRadius: "16px 16px 0 0",
          padding: 20,
          boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2
            id={headingId}
            style={{ margin: 0, fontSize: 20, fontWeight: 800 }}
          >
            Share my bracket
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            data-testid="share-close"
            style={{
              background: "transparent",
              border: 0,
              color: "#cbd5e1",
              fontSize: 24,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <ShareCard src={pngUrl} alt={subject} />

        <label
          htmlFor={`${headingId}-caption`}
          style={{
            display: "block",
            marginTop: 16,
            fontSize: 13,
            fontWeight: 700,
            color: "#94a3b8",
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Caption
        </label>
        <textarea
          id={`${headingId}-caption`}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          data-testid="share-caption"
          rows={3}
          style={{
            width: "100%",
            marginTop: 6,
            background: "#0a0e1a",
            color: "#fff",
            border: "1px solid #1e293b",
            borderRadius: 8,
            padding: 10,
            fontFamily: "inherit",
            fontSize: 14,
            resize: "vertical",
          }}
        />

        <div style={{ marginTop: 16 }}>
          <ShareButtons
            bracketId={payload.bracketId}
            url={shareUrl}
            text={caption}
            subject={subject}
            pngUrl={pngUrl}
          />
        </div>

        <p
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "#64748b",
            textAlign: "center",
          }}
        >
          Friends who play through your link beef up your leaderboard and earn you a referral bonus.
        </p>
      </div>
    </div>
  );
}
