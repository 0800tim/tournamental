/**
 * DraftWatermark, a low-opacity diagonal "PREVIEW" pattern rendered
 * behind any chart, podium, or large mock visualisation. The pattern
 * is a 1× inline SVG tile referenced as a CSS background, so it costs
 * zero extra network requests and tiles cleanly at any size.
 *
 * Render this as a wrapper around the content you want to mark:
 *
 *   <DraftWatermark>
 *     <PoolDistributionChart … />
 *   </DraftWatermark>
 *
 * The wrapper is `position: relative`; the watermark layer is an
 * absolute, pointer-events-none overlay so it never interferes with
 * clicks or pointer events on the underlying chart.
 */

import type { CSSProperties, ReactNode } from "react";

import "./draft.css";

const SVG_TILE = `
<svg xmlns='http://www.w3.org/2000/svg' width='220' height='80'>
  <text
    x='0' y='40'
    font-family='Inter, system-ui, sans-serif'
    font-weight='800'
    font-size='24'
    fill='%23ffffff'
    fill-opacity='0.08'
    letter-spacing='4'
    transform='rotate(-30 110 40)'
  >PREVIEW</text>
</svg>
`.replace(/\n/g, "").replace(/\s{2,}/g, " ");

export interface DraftWatermarkProps {
  readonly children: ReactNode;
  /**
   * Tile width in pixels. The default 220 produces a comfortable
   * 4–5 repeats across a 1000px card.
   */
  readonly tileWidth?: number;
  /**
   * Pass additional inline styles through to the wrapper for layout
   * (e.g. `height: 220px`).
   */
  readonly style?: CSSProperties;
  readonly className?: string;
}

export function DraftWatermark({
  children,
  tileWidth = 220,
  style,
  className,
}: DraftWatermarkProps) {
  const bgUrl = `url("data:image/svg+xml;utf8,${SVG_TILE.trim()}")`;
  return (
    <div
      className={`vt-draft-watermark ${className ?? ""}`.trim()}
      style={style}
    >
      <div
        className="vt-draft-watermark-layer"
        aria-hidden="true"
        style={{
          backgroundImage: bgUrl,
          backgroundSize: `${tileWidth}px auto`,
        }}
      />
      {children}
    </div>
  );
}
