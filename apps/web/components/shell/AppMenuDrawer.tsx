"use client";

/**
 * Full-screen menu drawer.
 *
 * Slides in from the right edge on every viewport size, triggered from
 * the hamburger button or the bottom-nav "Menu" tab. Holds the full
 * navigation surface (the World Cup microsite cross-links plus the
 * settings tail) so it is always available even when the desktop bar
 * already exposes the most-used primaries inline.
 *
 * Why a full-screen sheet, not a half-modal: a tournament microsite has
 * a deep enough secondary menu that a half-modal crowds the choices.
 * Full-screen reads as a primary destination.
 *
 * Closing: tap the X, tap the backdrop above the drawer, press Escape,
 * or back-navigate. On route change the drawer auto-closes because the
 * link onClick handlers call onClose before the route transition.
 *
 * The nav-link catalogue is owned by ./nav-links so the drawer and the
 * desktop nav share a single source of truth.
 */

import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { useUser } from "@/lib/auth/useUser";

import { InstallPrompt } from "./InstallPrompt";
import { LocalePicker } from "./LocalePicker";

import "./locale-picker.css";
import {
  DRAWER_PRIMARY,
  DRAWER_SECONDARY,
  type NavLink as DrawerLink,
} from "./nav-links";

export interface AppMenuDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AppMenuDrawer({ open, onClose }: AppMenuDrawerProps) {
  // Auth-aware Profile label — Tim 2026-05-22. The /profile route handles
  // its own auth wall, so the href stays constant either way; only the
  // visible label flips.
  const { status } = useUser();
  const t = useTranslations();
  const isAuthed = status === "authenticated";
  const primaryLinks = useMemo<readonly DrawerLink[]>(
    () =>
      DRAWER_PRIMARY.map((l) =>
        l.href === "/profile"
          ? {
              ...l,
              label: isAuthed ? "My Profile" : "Sign up / in",
              i18nKey: isAuthed ? "nav.profile_my" : "authchip.sign_in_up",
            }
          : l,
      ),
    [isAuthed],
  );

  const handleEsc = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener("keydown", handleEsc);
    // Lock body scroll while the drawer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = prev;
    };
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div
      className="vt-drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
    >
      <aside
        className="vt-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vt-drawer-header">
          <span className="vt-drawer-brand">
            {/* Brand mark: gold ball PNG, same source as the AppBar so
             * one cache-hit covers both surfaces. `?v=ball` cache-bust
             * mirrors the AppBar change from 2026-05-20 — necessary
             * because the drawer used to render a sky-blue "T" chip. */}
            <img
              src="/icons/icon-192.png?v=ball"
              alt=""
              width="28"
              height="28"
              decoding="async"
              className="vt-drawer-brand-mark"
            />
            <span className="vt-drawer-brand-name">Tournamental</span>
          </span>
          <button
            type="button"
            className="vt-drawer-close"
            aria-label="Close menu"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {/* Install affordance sits at the top of the drawer per Tim
         * 2026-05-21. The component returns null when the app is
         * already in standalone mode or the user dismissed within the
         * last 30 days, so a returning installed visitor doesn't see
         * a now-pointless prompt. */}
        <InstallPrompt />
        <div className="vt-drawer-locale-row">
          <LocalePicker variant="drawer" />
        </div>
        <div className="vt-drawer-section-label">FIFA World Cup 2026 &#8482;</div>
        <DrawerLinks links={primaryLinks} onClick={onClose} />
        <div className="vt-drawer-section-label">{safeT(t, "nav.section_brand", "Tournamental")}</div>
        <DrawerLinks links={DRAWER_SECONDARY} onClick={onClose} />
      </aside>
    </div>
  );
}

function DrawerLinks({
  links,
  onClick,
}: {
  links: readonly DrawerLink[];
  onClick: () => void;
}): ReactNode {
  const t = useTranslations();
  return (
    <ul className="vt-drawer-list">
      {links.map((link) => {
        const label = safeT(t, link.i18nKey, link.label);
        return (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className="vt-drawer-link"
                target="_blank"
                rel="noopener noreferrer"
                data-subitem={link.subItem ? "1" : undefined}
                onClick={onClick}
              >
                {link.icon}
                <span>{label}</span>
                <span className="vt-drawer-external-icon" aria-hidden="true">↗</span>
              </a>
            ) : (
              <Link
                href={link.href}
                className="vt-drawer-link"
                data-subitem={link.subItem ? "1" : undefined}
                onClick={onClick}
              >
                {link.icon}
                <span>{label}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Safe translation lookup. Returns the supplied English fallback when
 * the key is missing from the active locale's catalogue so a stub
 * locale never renders an empty pill.
 */
function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

/**
 * Hook that exposes drawer open/close state for use in the bottom nav.
 * Centralises the state so the bottom nav's "Menu" tap can drive it.
 */
import { useState as useStateLocal } from "react";

export function useMobileMenuState() {
  const [open, setOpen] = useStateLocal(false);
  return {
    open,
    openDrawer: () => setOpen(true),
    closeDrawer: () => setOpen(false),
    toggleDrawer: () => setOpen((p) => !p),
  };
}
