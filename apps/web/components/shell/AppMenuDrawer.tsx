"use client";

/**
 * App menu drawer — slides in from the right on every viewport.
 *
 * Replaces the old desktop side-rail + mobile-only menu sheet. Triggered
 * by the hamburger button in the top-right of the AppBar (all sizes) and
 * by the "Menu" tab in the mobile BottomNav. Holds every primary +
 * secondary destination plus the World Cup 2026 cross-links.
 *
 * Routing rules:
 *   - Internal app destinations stay in the SPA via `next/link`.
 *   - Marketing-site / external links (`external: true`) open in a new
 *     window with `rel="noopener noreferrer"` and a small ↗ glyph after
 *     the label so users can see they're leaving the Play app.
 *
 * Closing: tap the X, tap the backdrop, press Escape, or follow a link.
 */

import Link from "next/link";
import { useCallback, useEffect, type ReactNode } from "react";

import {
  HomeIcon,
  PredictIcon,
  WatchIcon,
  ProfileIcon,
  TrophyIcon,
  GroupsIcon,
  CodeIcon,
  SettingsIcon,
  MoleculeIcon,
  ShareIcon,
  PlusIcon,
} from "./icons";

interface DrawerLink {
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  /** Open in a new window. Marketing / GitHub / off-app links. */
  readonly external?: boolean;
  /** Render the link visually indented as a child of the preceding row. */
  readonly subItem?: boolean;
}

const PRIMARY: readonly DrawerLink[] = [
  { label: "Home",    href: "/",                icon: <HomeIcon /> },
  { label: "Predict", href: "/world-cup-2026",  icon: <PredictIcon /> },
  { label: "Watch",   href: "/watch",           icon: <WatchIcon /> },
  { label: "Profile", href: "/profile",         icon: <ProfileIcon /> },
];

const WC2026: readonly DrawerLink[] = [
  { label: "Bracket Prophet",      href: "/world-cup-2026",                                  icon: <PredictIcon /> },
  { label: "3D Molecule",          href: "/world-cup-2026/molecule",                         icon: <MoleculeIcon /> },
  { label: "Save & share",         href: "/world-cup-2026/save-share",                       icon: <ShareIcon /> },
  { label: "Watch the 2022 final", href: "/match/fifa-wc-2022-final-arg-fra-2022-12-18",     icon: <WatchIcon /> },
];

const SECONDARY: readonly DrawerLink[] = [
  { label: "Leaderboard",        href: "/leaderboard",                                icon: <TrophyIcon /> },
  { label: "Syndicates",         href: "https://tournamental.com/syndicates",         icon: <GroupsIcon />, external: true },
  { label: "Create a syndicate", href: "/syndicates/new",                             icon: <PlusIcon />, subItem: true },
  { label: "Open source",        href: "https://github.com/0800tim/tournamental",     icon: <CodeIcon />, external: true },
  { label: "Settings",           href: "/settings",                                   icon: <SettingsIcon /> },
];

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
        <DrawerLinks links={PRIMARY} onClick={onClose} />
        <div className="vt-drawer-section-label">World Cup 2026</div>
        <DrawerLinks links={WC2026} onClick={onClose} />
        <div className="vt-drawer-section-label">More</div>
        <DrawerLinks links={SECONDARY} onClick={onClose} />
      </aside>
    </div>
  );
}

/**
 * Tiny ↗ glyph appended after the label on external (new-window) rows so
 * the destination is visually distinct from internal SPA navigation.
 */
function ExternalGlyph() {
  return (
    <span aria-hidden="true" className="vt-drawer-external-icon">
      ↗
    </span>
  );
}

function DrawerLinks({
  links,
  onClick,
}: {
  links: readonly DrawerLink[];
  onClick: () => void;
}) {
  return (
    <ul className="vt-drawer-list">
      {links.map((link) => (
        <li key={link.href}>
          {link.external ? (
            <a
              href={link.href}
              className="vt-drawer-link"
              data-subitem={link.subItem ? "1" : undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClick}
            >
              {link.icon}
              <span>{link.label}</span>
              <ExternalGlyph />
            </a>
          ) : (
            <Link
              href={link.href}
              className="vt-drawer-link"
              data-subitem={link.subItem ? "1" : undefined}
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
