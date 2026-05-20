/**
 * Shared layout primitives: card root, brand strip, footer.
 *
 * Every legacy card has the same overall shape:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ [BRAND STRIP — TOURNAMENTAL wordmark + tournament context]│
 *   ├─────────────────────────────────────────────────────┤
 *   │                                                       │
 *   │                  CARD-SPECIFIC BODY                  │
 *   │                                                       │
 *   ├─────────────────────────────────────────────────────┤
 *   │ [FOOTER — @handle • tournamental.com/r/<id>]              │
 *   └─────────────────────────────────────────────────────┘
 *
 * The same component composes for both 1200x630 (`og`) and 1080x1920
 * (`story`) — the body is given the remaining vertical space and is
 * expected to use flex to distribute its children.
 *
 * @deprecated The sky-blue brand strip + navy chrome pattern is on the
 * way out. New work should compose `editorialHeadline`, `dateline`,
 * `tabularStatRow`, and `charcoalCanvas` from `src/editorial.ts`
 * instead. See `src/presets/` for canonical examples and the
 * "Migration from sky-blue" section in README.md.
 */

import { el, styles, type SatoriElement } from "./jsdl.js";
import { palette, sizes, referralLabel, type CardSize } from "./theme.js";
import { isRtl } from "./fonts.js";
import { maybePunditBadge, VERIFIED_PUNDIT_TEXT } from "./cards/pundit-badge.js";
import type { CommonFooter } from "./types.js";

export interface CardFrameArgs {
  size: CardSize;
  /** What the brand strip says on the right (e.g. tournament name). */
  brandContext?: string;
  /** The user handle to display in the footer. */
  userHandle: string;
  userId: string;
  /** Body element built by the card-specific renderer. */
  body: SatoriElement;
  /** Optional accent colour used for the strip + dividers. Defaults to accent.500. */
  accentHex?: string;
  /** Locale for direction handling. */
  locale?: string;
  /** Optional Verified-Pundit status. Renders a small gold tick + levels chip
   * next to the handle in the footer. */
  pundit?: CommonFooter["pundit"];
}

export function cardFrame(args: CardFrameArgs): SatoriElement {
  const { size, brandContext, userHandle, userId, body, accentHex, locale, pundit } = args;
  const dim = sizes[size];
  const accent = accentHex ?? palette.accent[500];
  const dir = isRtl(locale) ? "rtl" : "ltr";

  return el(
    "div",
    {
      style: {
        ...styles.root(dim.width, dim.height, palette.ink[900]),
        direction: dir,
      },
    },
    brandStrip({ accent, brandContext, size }),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        },
      },
      body,
    ),
    footerStrip({ userHandle, userId, size, pundit }),
  );
}

function brandStrip(args: {
  accent: string;
  brandContext?: string;
  size: CardSize;
}): SatoriElement {
  const { accent, brandContext, size } = args;
  const padX = size === "story" ? 56 : 56;
  const fontSize = size === "story" ? 30 : 26;

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `28px ${padX}px`,
        borderBottom: `2px solid ${accent}`,
        background: palette.ink[800],
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
        },
      },
      // V-mark
      el(
        "div",
        {
          style: {
            width: 38,
            height: 38,
            background: accent,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: palette.ink[900],
            fontWeight: 900,
            fontSize: 26,
          },
        },
        "V",
      ),
      el(
        "div",
        {
          style: {
            fontSize: fontSize + 4,
            fontWeight: 900,
            letterSpacing: 1.2,
            color: "#fff",
          },
        },
        "TOURNAMENTAL",
      ),
    ),
    brandContext
      ? el(
          "div",
          {
            style: {
              fontSize,
              color: palette.ink[200],
              fontWeight: 600,
              maxWidth: "60%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          brandContext,
        )
      : null,
  );
}

function footerStrip(args: {
  userHandle: string;
  userId: string;
  size: CardSize;
  pundit?: CommonFooter["pundit"];
}): SatoriElement {
  const { userHandle, userId, size, pundit } = args;
  const padX = size === "story" ? 56 : 56;
  const fontSize = size === "story" ? 26 : 22;
  const badgeSize = size === "story" ? 32 : 26;
  const badge = maybePunditBadge({ pundit }, { size: badgeSize });

  return el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `28px ${padX}px`,
        borderTop: `1px solid ${palette.ink[700]}`,
        fontSize,
        color: palette.ink[200],
        background: palette.ink[800],
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          fontWeight: 700,
          color: "#fff",
        },
      },
      `@${userHandle}`,
      badge,
      // The plain text marker is hidden visually (zero font-size) but
      // present in the satori tree so consumers can search-and-assert
      // ("Verified Pundit") without rendering a real PNG.
      badge
        ? el(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 0,
                width: 0,
                height: 0,
                overflow: "hidden",
              },
            },
            VERIFIED_PUNDIT_TEXT,
          )
        : null,
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
      },
      referralLabel(userId),
    ),
  );
}

/**
 * Truncate a long label so it fits a single line at the given pixel width.
 * Cheap heuristic used in the card body (we don't have layout measurement
 * outside satori). Worst case is over-truncation, never overflow.
 */
export function clamp(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return "…";
  return value.slice(0, maxChars - 1) + "…";
}
