"use client";

/**
 * Top app-bar, 56px tall sticky header used on every shelled page.
 * Layout: avatar (left) · title (centre) · context-action (right).
 *
 * Backdrop-blurs when the page scrolls; on canvas pages
 * (`variant="canvas"`) the bar floats over the renderer with translucent
 * blur and no opaque fill.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface AppBarProps {
  readonly title: string;
  /** Right-side context action, typically share / info / chat. */
  readonly rightAction?: AppBarAction;
  /** Click handler for the avatar (opens drawer in a future PR). */
  readonly onAvatarClick?: () => void;
  /** Optional initials shown when no avatar image is provided. */
  readonly avatarInitials?: string;
  /** When provided, an <img> is used instead of initials. */
  readonly avatarUrl?: string;
}

export interface AppBarAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

export function AppBar({
  title,
  rightAction,
  onAvatarClick,
  avatarInitials = "T",
  avatarUrl,
}: AppBarProps) {
  const [scrolled, setScrolled] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 4);
      lastY.current = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="vt-appbar"
      data-scrolled={scrolled ? "1" : "0"}
      role="banner"
    >
      <button
        type="button"
        className="vt-appbar-avatar"
        aria-label="Open profile menu"
        onClick={onAvatarClick}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={36}
            height={36}
            style={{ borderRadius: "999px", objectFit: "cover" }}
          />
        ) : (
          <span aria-hidden="true">{avatarInitials}</span>
        )}
      </button>
      <h1 className="vt-appbar-title" aria-live="polite">
        {title}
      </h1>
      {rightAction ? (
        <button
          type="button"
          className="vt-appbar-action"
          aria-label={rightAction.label}
          onClick={rightAction.onClick}
        >
          {rightAction.icon}
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </header>
  );
}
