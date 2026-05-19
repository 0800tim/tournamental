"use client";

import { CSSProperties } from "react";
import styles from "./TeamFlag.module.css";

type Size = "xs" | "sm" | "md" | "lg" | "xl";
type Shape = "rect" | "circle";

type Props = {
  /** FIFA 3-letter code, e.g. "ARG", "FRA" */
  code: string;
  /** team name, used for alt text + tooltip */
  name?: string;
  /** primary kit colour, used as glow accent */
  accentColor?: string;
  size?: Size;
  /** whether the sparkle sweep + idle wave animation are on */
  sparkle?: boolean;
  /** "rect" (default, classic 3:2 flag) or "circle" (square crop with
   *  border-radius, used by the bracket pick buttons). */
  shape?: Shape;
  /**
   * When true and `accentColor` is set, render a 3px solid kit-colour ring
   * around the flag. Composes additively with `sparkle`. Per
   * [doc 36 §TeamFlag](../../../docs/36-tournamental-ux-spec.md), used to mark
   * the picked team in `MatchPredictionRow` / `KnockoutMatch`.
   */
  selectionRing?: boolean;
  /**
   * When true, applies `filter: grayscale(0.6) opacity(0.5)` so unselected
   * sides in a knockout match visibly recede.
   */
  dim?: boolean;
  className?: string;
};

// Bumped per `feat/knockout-flag-backgrounds` (Tim, 2026-05-11). The old
// `sm` (24x16) was barely identifiable on knockout cells, and the page felt
// undersized for a flag-driven UI. New scale roughly doubles every step
// from xs upward; consumers that explicitly opted into "sm" still render at
// the old-ish cluster (32x22 instead of 24x16) so we don't blow up other
// rows. KnockoutMatch was bumped to `md` separately.
const SIZE: Record<Size, { w: number; h: number }> = {
  xs: { w: 16, h: 12 },
  sm: { w: 32, h: 22 },
  md: { w: 48, h: 32 },
  lg: { w: 72, h: 48 },
  xl: { w: 120, h: 80 },
};

// Circle pick targets need to be square + tap-friendly. Per Apple/Material
// guidelines minimum 44px; 64px hits "comfortably tappable" on phones.
const CIRCLE_SIZE: Record<Size, number> = {
  xs: 24,
  sm: 36,
  md: 56,
  lg: 64,
  xl: 96,
};

export function TeamFlag({
  code,
  name,
  accentColor = "#fbbf24",
  size = "md",
  sparkle = true,
  shape = "rect",
  selectionRing = false,
  dim = false,
  className = "",
}: Props) {
  const isCircle = shape === "circle";
  const circleDim = isCircle ? CIRCLE_SIZE[size] : null;
  const { w, h } = SIZE[size];
  const baseStyle: CSSProperties = isCircle
    ? ({
        width: circleDim,
        height: circleDim,
        borderRadius: "50%",
        overflow: "hidden",
        "--vt-flag-accent": accentColor,
      } as CSSProperties)
    : ({
        width: w,
        height: h,
        "--vt-flag-accent": accentColor,
      } as CSSProperties);

  // Selection ring: a heavy gold outline (4px), brand-consistent across
  // every pick rather than the kit-colour-per-team palette which was
  // visually noisy on a page full of group cards. Per Tim 2026-05-20.
  // Kit colour is still passed in via `accentColor` and used for the
  // soft outer glow in TeamFlag.module.css.
  const RING_GOLD = "var(--vt-gold-400, #dca94b)";
  const style: CSSProperties = selectionRing
    ? {
        ...baseStyle,
        outline: `4px solid ${RING_GOLD}`,
        outlineOffset: "2px",
      }
    : baseStyle;

  const wrapClassName = [
    styles.flagWrap,
    sparkle ? styles.sparkle : "",
    selectionRing ? styles.selectionRing : "",
    dim ? styles.dim : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={wrapClassName}
      style={style}
      aria-label={name ?? code}
      title={name ?? code}
      data-selection-ring={selectionRing ? "true" : undefined}
      data-dim={dim ? "true" : undefined}
    >
      <img
        className={styles.flagImg}
        src={`/flags/${code}.svg`}
        alt={`${name ?? code} flag`}
        width={isCircle ? circleDim! : w}
        height={isCircle ? circleDim! : h}
        loading="lazy"
        style={
          isCircle
            ? { width: "100%", height: "100%", objectFit: "cover" }
            : undefined
        }
      />
      {sparkle && <span className={styles.shimmer} aria-hidden="true" />}
      {sparkle && <span className={styles.glow} aria-hidden="true" />}
    </span>
  );
}
