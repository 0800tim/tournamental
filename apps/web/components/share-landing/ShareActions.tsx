"use client";

/**
 * Share-action CTAs for the `/s/<guid>` user-landing surface.
 *
 * Renders:
 *   - "Share this prediction" button — tries `navigator.share()` and
 *     falls back to a row of platform-specific deep-links if Web Share
 *     isn't available (desktop Chrome, Firefox).
 *
 * All deep-links use `window.location.href` at click time so the
 * URL always reflects the current page, even if the user navigated
 * client-side after first render.
 */

import { useCallback, useState } from "react";

export interface ShareActionsProps {
  readonly shareTitle: string;
  readonly shareText: string;
}

function encodeUrl(s: string): string {
  return encodeURIComponent(s);
}

export function ShareActions({ shareTitle, shareText }: ShareActionsProps) {
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const onShare = useCallback(async () => {
    const url =
      typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        return;
      } catch {
        // user cancelled or share failed — fall through to fallback
      }
    }
    setFallbackOpen((v) => !v);
  }, [shareTitle, shareText]);

  const currentUrl =
    typeof window !== "undefined" ? window.location.href : "";

  const links = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/?text=${encodeUrl(`${shareText} ${currentUrl}`)}`,
    },
    {
      key: "telegram",
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodeUrl(currentUrl)}&text=${encodeUrl(shareText)}`,
    },
    {
      key: "x",
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${encodeUrl(shareText)}&url=${encodeUrl(currentUrl)}`,
    },
    {
      key: "facebook",
      label: "Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeUrl(currentUrl)}`,
    },
  ];

  return (
    <div className="vt-share-ctas-wrap">
      <div className="vt-share-ctas">
        <a className="vt-share-cta" data-variant="primary" href="/world-cup-2026">
          Make your bracket
        </a>
        <button
          className="vt-share-cta"
          data-variant="secondary"
          type="button"
          onClick={onShare}
          aria-expanded={fallbackOpen}
        >
          Share this prediction
        </button>
      </div>
      {fallbackOpen ? (
        <div className="vt-share-fallback" role="group" aria-label="Share platforms">
          {links.map((l) => (
            <a
              key={l.key}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
