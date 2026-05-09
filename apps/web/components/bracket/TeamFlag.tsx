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
  className = "",
}: Props) {
  const isCircle = shape === "circle";
  const dim = isCircle ? CIRCLE_SIZE[size] : null;
  const { w, h } = SIZE[size];
  const style: CSSProperties = isCircle
    ? ({
        width: dim,
        height: dim,
        borderRadius: "50%",
        overflow: "hidden",
        "--vt-flag-accent": accentColor,
      } as CSSProperties)
    : ({
        width: w,
        height: h,
        "--vt-flag-accent": accentColor,
      } as CSSProperties);

  return (
    <span
      className={`${styles.flagWrap} ${sparkle ? styles.sparkle : ""} ${className}`}
      style={style}
      aria-label={name ?? code}
      title={name ?? code}
    >
      <img
        className={styles.flagImg}
        src={`/flags/${code}.svg`}
        alt={`${name ?? code} flag`}
        width={isCircle ? dim! : w}
        height={isCircle ? dim! : h}
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
