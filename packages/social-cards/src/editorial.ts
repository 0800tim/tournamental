/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Editorial primitives — the shared design system for the gold +
 * charcoal preset family in `src/presets/`.
 *
 * Mirrors the visual grammar of `apps/web/app/api/og/syndicate/route.ts`
 * (the canonical reference for a single editorial 1200x630 PNG) and the
 * BRAND.md gold scale (`docs/BRAND.md` Section 2). When the syndicate
 * route changes, update these primitives in the same PR so every share
 * card stays on-brand.
 *
 * Surface:
 *
 *   - `goldBall(size)`         -> inline-SVG `<img>` of the gold lattice
 *                                 ball mark. Pure data URL; satori does
 *                                 not need a network fetch.
 *   - `dateline(text)`         -> gold mono caption with a leading
 *                                 hairline rule.
 *   - `editorialHeadline()`    -> Fraunces 500 display headline with an
 *                                 optional italic-gold emphasis word.
 *   - `tabularStatRow(cells)`  -> 3-cell stat row in Fraunces tabular
 *                                 numerals + mono labels, with a
 *                                 hairline rule above.
 *   - `charcoalCanvas(...)`    -> the flat `#15151a` page root.
 *
 * All primitives return the satori JSON shape (no React, no JSX), so
 * they compose cleanly with `el(...)` from `jsdl.ts`.
 */

import type { SatoriElement } from "./jsdl.js";
import { charcoal, gold } from "./theme.js";

export type Size = "og" | "story";

export const SIZE_DIMENSIONS: Readonly<Record<Size, { width: number; height: number }>> = {
  og: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
};

/**
 * Per-size typography + spacing scale. Landscape is the baseline (1.0);
 * the 9:16 story canvas scales up so the headline still dominates on a
 * tall format.
 */
export function editorialScale(size: Size): {
  scale: number;
  padding: number;
  ballSize: number;
  datelineFont: number;
  headlineFont: number;
  italicFont: number;
  statNumFont: number;
  statLabelFont: number;
  footerFont: number;
  ruleColumnGap: number;
  rowGap: number;
} {
  if (size === "story") {
    return {
      scale: 1.4,
      padding: 88,
      ballSize: 120,
      // Dateline tightened from 36 -> 28 so it fits a single line on a
      // story canvas with the longest expected payload
      // ("LEADERBOARD · 2026-05-21 · @messi-fan").
      datelineFont: 28,
      headlineFont: 150,
      italicFont: 150,
      // Stat numerals must clear three cells side by side in the bottom
      // band, including string values like "Match 47 of 64". Drop the
      // base size from 112 -> 78 so the longest stat does not run off
      // the canvas edge.
      statNumFont: 78,
      statLabelFont: 22,
      footerFont: 28,
      ruleColumnGap: 36,
      rowGap: 44,
    };
  }
  return {
    scale: 1,
    padding: 72,
    ballSize: 86,
    datelineFont: 24,
    headlineFont: 96,
    italicFont: 96,
    statNumFont: 72,
    statLabelFont: 18,
    footerFont: 22,
    ruleColumnGap: 48,
    rowGap: 28,
  };
}

/**
 * Inline SVG of the gold lattice ball mark.
 *
 * The shape mirrors the syndicate OG route exactly: a gold-filled coin
 * with a centre pentagon, three peripheral pentagons (visual rhythm),
 * and faint connecting strokes for the lattice impression. Pure SVG so
 * the render does not depend on `apps/web/public/icons/icon-192.png`
 * being shipped alongside the package — the social-cards workspace
 * stays standalone.
 *
 * @param size - rendered width + height in pixels.
 */
export function goldBall(size: number): SatoriElement {
  const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ball" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stop-color="#f0d27a" />
          <stop offset="55%" stop-color="${gold[400]}" />
          <stop offset="100%" stop-color="${gold[600]}" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#ball)" stroke="${gold[700]}" stroke-width="2" />
      <polygon points="50,30 65,42 60,60 40,60 35,42" fill="${charcoal.bg}" opacity="0.55" />
      <polygon points="20,38 33,32 38,44 28,52 18,46" fill="${charcoal.bg}" opacity="0.32" />
      <polygon points="82,38 87,46 78,52 68,44 73,32" fill="${charcoal.bg}" opacity="0.32" />
      <polygon points="50,72 60,80 50,90 40,80" fill="${charcoal.bg}" opacity="0.32" />
      <line x1="50" y1="30" x2="50" y2="14" stroke="${gold[700]}" stroke-width="1.5" opacity="0.6" />
      <line x1="35" y1="42" x2="20" y2="38" stroke="${gold[700]}" stroke-width="1.5" opacity="0.6" />
      <line x1="65" y1="42" x2="82" y2="38" stroke="${gold[700]}" stroke-width="1.5" opacity="0.6" />
      <line x1="40" y1="60" x2="40" y2="80" stroke="${gold[700]}" stroke-width="1.5" opacity="0.6" />
      <line x1="60" y1="60" x2="60" y2="80" stroke="${gold[700]}" stroke-width="1.5" opacity="0.6" />
    </svg>
  `;
  return {
    type: "img",
    props: {
      width: size,
      height: size,
      src: `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`,
      style: {
        width: size,
        height: size,
        borderRadius: "50%",
      },
    },
  };
}

/**
 * Gold mono dateline with a leading hairline rule.
 *
 * Example renders as:
 *
 *   ──── TOURNAMENTAL · FWC2026
 *
 * The leading rule is part of the same horizontal flex container so the
 * spacing reads as one element rather than a hyphen + text. The caller
 * controls the full string; this primitive does not uppercase or
 * letter-space the input beyond the CSS rules below.
 */
export function dateline(
  text: string,
  opts: { size: Size; ruleWidth?: number } = { size: "og" },
): SatoriElement {
  const s = editorialScale(opts.size);
  const ruleWidth = opts.ruleWidth ?? Math.round(40 * s.scale);

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        gap: "0.7em",
        fontFamily: "EditorialMono",
        fontSize: s.datelineFont,
        color: gold[400],
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        fontWeight: 500,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: ruleWidth,
              height: 1,
              background: gold[400],
            },
          },
        },
        text,
      ],
    },
  };
}

export interface EditorialHeadlineOpts {
  /**
   * Optional emphasis fragment rendered in italic gold inside the same
   * line. Useful for "@User *backs* TeamX to beat TeamY" or "7 calls,
   * 7 *right*." The fragment must appear verbatim somewhere in `text`;
   * otherwise the headline renders without emphasis.
   */
  italic?: string;
  /** Optional explicit font-size override. Defaults to the size scale. */
  fontSize?: number;
  /** Max width for word-wrap. Defaults to the parent's auto width. */
  maxWidth?: number | string;
}

/**
 * Fraunces 500 display headline with an optional italic-gold emphasis
 * fragment.
 *
 * The headline auto-shrinks for very long strings: anything over 90
 * characters drops a tier so the line still fits the 1200x630 OG
 * canvas. The story variant gets bigger headroom from
 * `editorialScale()` rather than from this helper.
 *
 * @param text  - full headline (the emphasis fragment must be a literal
 *                substring of this if `opts.italic` is set).
 * @param size  - "og" | "story" — drives the size scale.
 * @param opts  - emphasis + optional overrides.
 */
export function editorialHeadline(
  text: string,
  size: Size,
  opts: EditorialHeadlineOpts = {},
): SatoriElement {
  const s = editorialScale(size);

  // Long-headline taper: ~26 chars fits the OG canvas at the base size.
  // Stories are narrower (1080 vs 1200) so the taper kicks in earlier.
  const len = text.length;
  const taper =
    size === "story"
      ? len > 56
        ? 0.5
        : len > 38
          ? 0.62
          : len > 28
            ? 0.78
            : len > 20
              ? 0.9
              : 1
      : len > 64
        ? 0.62
        : len > 42
          ? 0.78
          : len > 28
            ? 0.9
            : 1;
  const fontSize = opts.fontSize ?? Math.round(s.headlineFont * taper);

  const baseStyle = {
    fontFamily: "Fraunces",
    fontSize,
    fontWeight: 500,
    letterSpacing: "-0.018em",
    lineHeight: 0.98,
    color: charcoal.fgStrong,
    display: "flex",
    flexWrap: "wrap",
    ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
  } as const;

  // No emphasis: a single text node keeps satori's line-break logic
  // pristine. With emphasis, we split into three flex children:
  //   [head, italicGold, tail]
  // and rely on flexWrap to put the fragments on shared lines where
  // they fit.
  if (!opts.italic || !text.includes(opts.italic)) {
    return {
      type: "div",
      props: {
        style: baseStyle,
        children: text,
      },
    };
  }

  const idx = text.indexOf(opts.italic);
  const head = text.slice(0, idx);
  const tail = text.slice(idx + opts.italic.length);

  const segment = (value: string, italic: boolean): SatoriElement => ({
    type: "span",
    props: {
      style: {
        fontFamily: "Fraunces",
        fontSize,
        fontWeight: 500,
        fontStyle: italic ? "italic" : "normal",
        color: italic ? gold[400] : charcoal.fgStrong,
        letterSpacing: "-0.018em",
        lineHeight: 0.98,
        // Preserve leading / trailing whitespace at segment boundaries.
        // Without this, satori's flex layout collapses the space between
        // the head ("@user ") and the italic emphasis ("backs"), which
        // crashes the two words together visually.
        whiteSpace: "pre-wrap",
      },
      children: value,
    },
  });

  const children: SatoriElement[] = [];
  if (head) children.push(segment(head, false));
  children.push(segment(opts.italic, true));
  if (tail) children.push(segment(tail, false));

  return {
    type: "div",
    props: {
      style: {
        ...baseStyle,
        flexDirection: "row",
      },
      children,
    },
  };
}

export interface StatCell {
  /** Big number rendered in Fraunces 500 tabular numerals (gold). */
  value: string | number;
  /** Mono caption beneath the number (uppercase, gold-deep tracking). */
  label: string;
}

/**
 * Three-up stat row, with a hairline rule above.
 *
 * Mirrors the syndicate OG bottom band exactly: a 1px `gold-600 @ 55%`
 * rule, then a `space-between` row of stat cells. Each cell stacks
 * `value` (Fraunces tabular numerals, gold) above `label` (mono,
 * muted). Pass 1-4 cells; 3 is the canonical layout.
 */
export function tabularStatRow(
  cells: ReadonlyArray<StatCell>,
  size: Size,
): SatoriElement {
  const s = editorialScale(size);

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: s.rowGap,
      },
      children: [
        // Hairline rule above the stats.
        {
          type: "div",
          props: {
            style: {
              width: "100%",
              height: 1,
              background: gold[600],
              opacity: 0.55,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: s.ruleColumnGap,
            },
            children: cells.map((cell) => statCell(cell, s)),
          },
        },
      ],
    },
  };
}

function statCell(
  cell: StatCell,
  s: ReturnType<typeof editorialScale>,
): SatoriElement {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              fontFamily: "Fraunces",
              fontSize: s.statNumFont,
              fontWeight: 500,
              color: gold[400],
              lineHeight: 0.95,
              fontFeatureSettings: '"tnum" 1, "lnum" 1',
              letterSpacing: "-0.01em",
            },
            children: String(cell.value),
          },
        },
        {
          type: "div",
          props: {
            style: {
              fontFamily: "EditorialMono",
              fontSize: s.statLabelFont,
              color: charcoal.fgMuted,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 500,
            },
            children: cell.label,
          },
        },
      ],
    },
  };
}

/**
 * Flat charcoal canvas root. No radial, no gradient — that pattern
 * reads as "AI slop" against the editorial system (see BRAND.md §6).
 *
 * Children are stacked vertically with `space-between` so the standard
 * three-band layout (dateline / headline / stats+footer) reads top to
 * bottom on the landscape OG canvas, and stretches gracefully on the
 * 9:16 story canvas.
 */
export function charcoalCanvas(args: {
  size: Size;
  children: ReadonlyArray<SatoriElement | null | undefined | false>;
  /** Optional padding override (defaults to the size scale). */
  padding?: number;
}): SatoriElement {
  const { size, padding } = args;
  const dim = SIZE_DIMENSIONS[size];
  const s = editorialScale(size);
  const pad = padding ?? s.padding;

  const children = args.children.filter(
    (c): c is SatoriElement => Boolean(c),
  );

  return {
    type: "div",
    props: {
      style: {
        width: dim.width,
        height: dim.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: charcoal.bg,
        padding: pad,
        color: charcoal.fgStrong,
        fontFamily: "Fraunces",
        position: "relative",
      },
      children,
    },
  };
}

/**
 * Footer URL pinned bottom-right of the stat row.
 *
 * Used by the four new presets to render their `play.tournamental.com/s/<slug>`
 * link in mono gold. Kept as a separate primitive (rather than baked
 * into `tabularStatRow`) because some presets want the URL as the third
 * stat-row cell and others want it on a separate footer band.
 */
export function footerUrl(text: string, size: Size): SatoriElement {
  const s = editorialScale(size);
  return {
    type: "div",
    props: {
      style: {
        fontFamily: "EditorialMono",
        fontSize: s.footerFont,
        color: gold[400],
        letterSpacing: "0.04em",
        textAlign: "right",
        fontWeight: 600,
        display: "flex",
        alignItems: "flex-end",
      },
      children: text,
    },
  };
}
