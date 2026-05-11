"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Collapsible HUD card, single source of truth for the right-edge
 * peripheral panels (scorers, stats, subs).
 *
 * Collapsed state is a glass pill showing a tiny icon, title, and a
 * chevron. Expanded state slides open to reveal the children. The
 * collapsed/expanded preference persists in localStorage under
 * `tournamental.match.hud.<id>` so the player's last layout choice
 * survives reloads.
 *
 * Visual language matches the molecule polish bar in
 * `apps/web/components/molecule/molecule.css`, translucent navy
 * background, 1px hairline border, 12px radius, backdrop-filter blur,
 * gold accent on focus.
 *
 * `pointer-events: auto` so the header is clickable through the global
 * pointer-events-none HUD overlay.
 */
export interface CollapsibleHUDCardProps {
  /** Unique id used for the localStorage key + DOM test selectors. */
  id: string;
  /** Card title (small caps in the header strip). */
  title: string;
  /** Tiny icon glyph (emoji or short string) shown left of the title. */
  icon?: ReactNode;
  /** Card contents shown only when expanded. */
  children: ReactNode;
  /** Initial state on first ever visit. Defaults to collapsed. */
  defaultCollapsed?: boolean;
  /** Optional override for the data-side attribute (right by default). */
  side?: "left" | "right";
  /** Optional override for the data-empty attribute (dims when "1"). */
  empty?: boolean;
}

const STORAGE_PREFIX = "tournamental.match.hud.";

function readPref(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === "open") return false;
    if (raw === "collapsed") return true;
  } catch {
    /* localStorage may be disabled in some contexts; quietly fall back */
  }
  return fallback;
}

function writePref(id: string, collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + id,
      collapsed ? "collapsed" : "open",
    );
  } catch {
    /* swallow */
  }
}

export function CollapsibleHUDCard({
  id,
  title,
  icon,
  children,
  defaultCollapsed = true,
  side = "right",
  empty = false,
}: CollapsibleHUDCardProps) {
  // Read the persisted preference ONCE on mount to avoid SSR hydration
  // flashes, we render the SSR-stable default first, then resolve the
  // stored value in a layout-safe useEffect.
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCollapsed(readPref(id, defaultCollapsed));
    setHydrated(true);
  }, [id, defaultCollapsed]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writePref(id, next);
      return next;
    });
  }, [id]);

  return (
    <section
      className="hud-card-shell"
      data-testid={`hud-card-${id}`}
      data-card-id={id}
      data-collapsed={collapsed ? "1" : "0"}
      data-side={side}
      data-empty={empty ? "1" : "0"}
      data-hydrated={hydrated ? "1" : "0"}
      aria-label={title}
    >
      <button
        type="button"
        className="hud-card-head"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={`hud-card-body-${id}`}
        data-testid={`hud-card-toggle-${id}`}
      >
        {icon ? (
          <span className="hud-card-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="hud-card-title">{title}</span>
        <span className="hud-card-chevron" aria-hidden>
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path
              d="M2.5 4 L6 7.5 L9.5 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div
        className="hud-card-body"
        id={`hud-card-body-${id}`}
        data-testid={`hud-card-body-${id}`}
        aria-hidden={collapsed}
      >
        <div className="hud-card-body-inner">{children}</div>
      </div>
    </section>
  );
}
