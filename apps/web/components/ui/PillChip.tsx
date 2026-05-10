/**
 * Small rounded-full chip. Used inside hero cards, news cards, match
 * cards, and as standalone category labels.
 */

import type { ReactNode } from "react";

import "./ui.css";

export interface PillChipProps {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "accent" | "warm" | "pitch";
  readonly className?: string;
}

export function PillChip({
  children,
  tone = "neutral",
  className,
}: PillChipProps) {
  return (
    <span
      className={`vt-pill-chip${className ? ` ${className}` : ""}`}
      data-tone={tone === "neutral" ? undefined : tone}
    >
      {children}
    </span>
  );
}
