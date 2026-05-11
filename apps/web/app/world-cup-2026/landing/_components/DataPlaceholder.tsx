/**
 * Wraps a piece of placeholder content (mock data, "Coming soon" stub) in
 * a clearly-labelled chip so we never ship something that *looks* like real
 * live data without being it. Visual: dashed amber border, small chip.
 */

import type { ReactNode } from "react";

export function DataPlaceholder({ children }: { children: ReactNode }) {
  return (
    <span
      className="wc-data-placeholder"
      title="Mock data, live integration coming soon"
    >
      {children}
    </span>
  );
}
