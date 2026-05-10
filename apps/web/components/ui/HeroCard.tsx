/**
 * HeroCard — image-backed gradient card with a category pill and a
 * bold headline. Tappable. Used at the top of the home feed.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { PillChip } from "./PillChip";

import "./ui.css";

export interface HeroCardProps {
  readonly title: string;
  readonly category?: string;
  readonly subtitle?: string;
  readonly href?: string;
  readonly imageUrl?: string;
  /** When `imageUrl` is omitted, falls back to a brand gradient. */
  readonly fallbackGradient?: string;
  readonly children?: ReactNode;
}

export function HeroCard({
  title,
  category,
  subtitle,
  href,
  imageUrl,
  fallbackGradient = "linear-gradient(135deg, #2071b8, #6cabdd 60%, #f3b83b)",
  children,
}: HeroCardProps) {
  const inner = (
    <>
      <div
        className="vt-hero-card-bg"
        style={{
          background: imageUrl ? `url(${imageUrl})` : fallbackGradient,
          backgroundSize: imageUrl ? "cover" : undefined,
        }}
        aria-hidden="true"
      />
      <div className="vt-hero-card-grad" aria-hidden="true" />
      <div className="vt-hero-card-body">
        {category ? (
          <span className="vt-hero-card-cat">
            <PillChip tone="accent">{category}</PillChip>
          </span>
        ) : null}
        <h2 className="vt-hero-card-title">{title}</h2>
        {subtitle ? <p className="vt-hero-card-sub">{subtitle}</p> : null}
        {children}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="vt-hero-card">
        {inner}
      </Link>
    );
  }
  return <div className="vt-hero-card">{inner}</div>;
}
