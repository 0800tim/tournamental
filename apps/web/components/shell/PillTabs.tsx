"use client";

/**
 * Horizontal pill tabs used on sub-pages with multiple panes (bracket,
 * match preview, team detail, leaderboard). Selected pill is outlined
 * in `--vt-fg`; inactive pills sit on a translucent `--vt-bg-elev`.
 *
 * Either controlled (`active` + `onChange`) or uncontrolled (renders
 * `<a>` elements via `href`).
 */

import Link from "next/link";

export interface PillTab {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
}

export interface PillTabsProps {
  readonly tabs: readonly PillTab[];
  readonly active?: string;
  readonly onChange?: (id: string) => void;
  readonly ariaLabel?: string;
}

export function PillTabs({ tabs, active, onChange, ariaLabel }: PillTabsProps) {
  return (
    <div
      className="vt-pilltabs"
      role="tablist"
      aria-label={ariaLabel ?? "Section tabs"}
    >
      {tabs.map((tab) => {
        const isSelected = active === tab.id;
        if (tab.href && !onChange) {
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className="vt-pilltab"
              role="tab"
              aria-selected={isSelected}
            >
              {tab.label}
            </Link>
          );
        }
        return (
          <button
            key={tab.id}
            type="button"
            className="vt-pilltab"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange?.(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
