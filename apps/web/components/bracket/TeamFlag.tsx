"use client";

import { CSSProperties } from "react";
import styles from "./TeamFlag.module.css";

type Size = "sm" | "md" | "lg" | "xl";
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
   *  border-radius — used by the bracket pick buttons). */
  shape?: Shape;
  /**
   * When true and `accentColor` is set, render a 3px solid kit-colour ring
   * around the flag. Composes additively with `sparkle`. Per
   * [doc 36 §TeamFlag](../../../docs/36-vtourn-ux-spec.md), used to mark
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

const SIZE: Record<Size, { w: number; h: number }> = {
  sm: { w: 24, h: 16 },
  md: { w: 36, h: 24 },
  lg: { w: 60, h: 40 },
  xl: { w: 120, h: 80 },
};

// Circle pick targets need to be square + tap-friendly. Per Apple/Material
// guidelines minimum 44px; 64px hits "comfortably tappable" on phones.
const CIRCLE_SIZE: Record<Size, number> = {
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

  // Selection ring: 3px solid kit-colour outline. We use `outline` rather
  // than `box-shadow` so the ring sits cleanly outside the flag's own
  // border-radius and composes with the existing glow halo.
  const style: CSSProperties = selectionRing
    ? {
        ...baseStyle,
        outline: `3px solid ${accentColor}`,
        outlineOffset: "1px",
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
