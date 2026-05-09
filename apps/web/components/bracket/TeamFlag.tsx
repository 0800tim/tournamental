"use client";

import { CSSProperties } from "react";
import styles from "./TeamFlag.module.css";

type Size = "sm" | "md" | "lg" | "xl";

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
  className?: string;
};

const SIZE: Record<Size, { w: number; h: number }> = {
  sm: { w: 24, h: 16 },
  md: { w: 36, h: 24 },
  lg: { w: 60, h: 40 },
  xl: { w: 120, h: 80 },
};

export function TeamFlag({
  code,
  name,
  accentColor = "#fbbf24",
  size = "md",
  sparkle = true,
  className = "",
}: Props) {
  const { w, h } = SIZE[size];
  const style: CSSProperties = {
    width: w,
    height: h,
    "--vt-flag-accent": accentColor,
  } as CSSProperties;

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
        width={w}
        height={h}
        loading="lazy"
      />
      {sparkle && <span className={styles.shimmer} aria-hidden="true" />}
      {sparkle && <span className={styles.glow} aria-hidden="true" />}
    </span>
  );
}
