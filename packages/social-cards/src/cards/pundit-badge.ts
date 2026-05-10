/**
 * Shared satori "Verified Pundit" tick used by every card kind.
 *
 * Subtle — small gold-tinted check rendered as inline SVG. No animation
 * (cards are stills). The badge is part of every footer when the user is
 * verified so the trust signal travels with every share.
 *
 * Future-revenue-share hook (TODO, do NOT implement here): the same
 * payload is the canonical signal for the Drips Network contributor
 * allocation per docs/19.
 */

import { el, type SatoriElement } from "../jsdl.js";
import type { CommonFooter } from "../types.js";

const GOLD_RING = "#c9a21f";
const GOLD_FILL = "#f1c84b";
const GOLD_INK = "#1f1604";

/**
 * Build the inline SVG mark used inside the badge bubble. Returns a
 * data-URI that satori can render via `<img>` — keeping it as an asset
 * means we don't depend on satori's SVG-element support, which has
 * subtle reflow quirks at small sizes.
 */
function tickDataUri(): string {
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2.4 6.2 L4.8 8.5 L9.6 3.5" fill="none" stroke="${GOLD_INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface PunditBadgeOptions {
  size?: number;
  /** When true, render the small "×N" level chip when levels >= 2. */
  showLevels?: boolean;
}

/**
 * Returns null when the supplied footer has no verified pundit; otherwise
 * a SatoriElement that callers can place anywhere a tick is appropriate.
 */
export function maybePunditBadge(
  footer: Pick<CommonFooter, "pundit">,
  opts: PunditBadgeOptions = {},
): SatoriElement | null {
  const p = footer.pundit;
  if (!p || !p.verified) return null;
  const size = opts.size ?? 26;
  const showLevels = opts.showLevels ?? true;

  const tick = el("img", {
    src: tickDataUri(),
    width: Math.max(10, Math.round(size * 0.6)),
    height: Math.max(10, Math.round(size * 0.6)),
    style: { display: "flex" },
  });

  const bubble = el(
    "div",
    {
      "data-testid": "pundit-badge",
      "data-pundit-levels": String(p.levels),
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: GOLD_FILL,
        boxShadow: `inset 0 0 0 1px ${GOLD_RING}`,
      },
    },
    tick,
  );

  if (!showLevels || p.levels < 2) {
    return bubble;
  }

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      },
    },
    bubble,
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2px 8px",
          borderRadius: 999,
          background: "#1a2238",
          color: "#fff",
          fontSize: Math.max(12, Math.round(size * 0.45)),
          fontWeight: 800,
        },
      },
      `×${p.levels}`,
    ),
  );
}

/** Plain-text marker so test helpers can pattern-match the verified label. */
export const VERIFIED_PUNDIT_TEXT = "Verified Pundit";
