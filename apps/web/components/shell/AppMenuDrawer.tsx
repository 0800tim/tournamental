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

import Link from "next/link";
import { useCallback, useEffect, type ReactNode } from "react";

import {
  DRAWER_PRIMARY,
  DRAWER_WC2026,
  DRAWER_SECONDARY,
  type NavLink as DrawerLink,
} from "./nav-links";

export interface AppMenuDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AppMenuDrawer({ open, onClose }: AppMenuDrawerProps) {
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
            <span className="vt-drawer-brand-mark" aria-hidden="true">T</span>
            Tournamental
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
        <div className="vt-drawer-section-label">App</div>
        <DrawerLinks links={DRAWER_PRIMARY} onClick={onClose} />
        <div className="vt-drawer-section-label">World Cup 2026</div>
        <DrawerLinks links={DRAWER_WC2026} onClick={onClose} />
        <div className="vt-drawer-section-label">More</div>
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
  return (
    <ul className="vt-drawer-list">
      {links.map((link) => (
        <li key={link.href}>
          {link.external ? (
            <a
              href={link.href}
              className="vt-drawer-link"
              target="_blank"
              rel="noreferrer"
              onClick={onClick}
            >
              {link.icon}
              <span>{link.label}</span>
            </a>
          ) : (
            <Link
              href={link.href}
              className="vt-drawer-link"
              onClick={onClick}
            >
              {link.icon}
              <span>{link.label}</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
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
