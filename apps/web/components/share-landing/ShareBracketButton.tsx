"use client";

/**
 * "Share my predictions" CTA on the /s/<handle> user landing hero.
 *
 * Calls `navigator.share()` so mobile devices get the native iOS /
 * Android share sheet, with a copy-link toast as the fallback for
 * desktop browsers that don't support Web Share (Firefox, older
 * Chrome). The page URL is captured at click time so client-side
 * navigation is reflected.
 *
 * Owner-vs-viewer copy: when the signed-in viewer matches the
 * bracket owner the button reads "share my predictions"; otherwise
 * it reads "share this bracket". Both fire the same share intent;
 * the copy just stays honest about whose picks are being shared.
 *
 * Tim 2026-06-04.
 */

import { useCallback, useState } from "react";

import { useUser } from "@/lib/auth/useUser";

import "./share-bracket-button.css";

export interface ShareBracketButtonProps {
  /** Bracket-owner auth user id; matched against the signed-in viewer to pick the right copy. */
  readonly ownerUserId: string | null;
  /** Owner display handle, used in the share-sheet title/text. */
  readonly handle: string;
  /** Owner's predicted champion display name, baked into the share text. */
  readonly championName: string;
  /** Tournament label (e.g. "Football World Cup 2026") for the share-sheet title. */
  readonly tournamentLabel: string;
}

type ToastKind = "copied" | "error";

export function ShareBracketButton(props: ShareBracketButtonProps) {
  const { ownerUserId, handle, championName, tournamentLabel } = props;
  const auth = useUser();
  const viewerIsOwner =
    !!ownerUserId &&
    auth.status === "authenticated" &&
    !!auth.user?.id &&
    auth.user.id === ownerUserId;

  const [toast, setToast] = useState<ToastKind | null>(null);

  const onShare = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const title = `@${handle} on Tournamental, ${tournamentLabel}`;
    const text = viewerIsOwner
      ? `I picked ${championName} to lift the trophy. See my full bracket:`
      : `@${handle} picked ${championName} to lift the trophy. See the full bracket:`;

    const nav: Navigator | undefined =
      typeof navigator !== "undefined" ? navigator : undefined;

    if (nav && "share" in nav) {
      try {
        await nav.share({ title, text, url });
        return;
      } catch {
        // User cancelled the share sheet, treat as no-op.
        return;
      }
    }

    // Copy-link fallback for desktop browsers without Web Share.
    if (nav?.clipboard) {
      try {
        await nav.clipboard.writeText(url);
        setToast("copied");
        window.setTimeout(() => setToast(null), 2200);
        return;
      } catch {
        setToast("error");
        window.setTimeout(() => setToast(null), 2200);
        return;
      }
    }

    setToast("error");
    window.setTimeout(() => setToast(null), 2200);
  }, [championName, handle, tournamentLabel, viewerIsOwner]);

  return (
    <div className="vt-share-bracket-wrap">
      <button
        type="button"
        className="vt-share-bracket-btn"
        onClick={onShare}
        data-testid="share-bracket-button"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        {viewerIsOwner ? "share my predictions" : "share this bracket"}
      </button>
      {toast === "copied" ? (
        <span className="vt-share-bracket-toast" role="status">
          Link copied
        </span>
      ) : null}
      {toast === "error" ? (
        <span
          className="vt-share-bracket-toast"
          data-tone="err"
          role="status"
        >
          Could not share. Copy the URL from the address bar.
        </span>
      ) : null}
    </div>
  );
}
