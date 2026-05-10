/**
 * `ShareCard` — large image preview of the server-rendered OG card.
 *
 * Renders the `/api/og/[bracketId]` PNG as a 1200×630 hero. Uses a
 * plain `<img>` (not next/image) so the preview can be downloaded /
 * right-click-copied straight from the page without going through the
 * image-optimisation pipeline.
 */

"use client";

import type { CSSProperties } from "react";

export interface ShareCardProps {
  /** Public URL of the OG PNG. */
  readonly src: string;
  /** Alt text (defaults to a sensible bracket description). */
  readonly alt?: string;
  /** Optional className for layout sites that want to nudge the frame. */
  readonly className?: string;
  /** Inline style overrides. */
  readonly style?: CSSProperties;
}

export function ShareCard({ src, alt, className, style }: ShareCardProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? "Bracket share preview"}
      width={1200}
      height={630}
      className={className}
      style={{
        width: "100%",
        height: "auto",
        aspectRatio: "1200 / 630",
        borderRadius: 16,
        background: "#0a0e1a",
        display: "block",
        ...style,
      }}
      loading="lazy"
      decoding="async"
      data-testid="share-card-preview"
    />
  );
}
