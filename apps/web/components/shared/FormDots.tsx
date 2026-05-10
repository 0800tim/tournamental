/**
 * FormDots — five W/D/L pills representing a team's last 5 results.
 *
 * Per the UX spec ([doc 36 — `FormDots` — NEW](../../../../docs/36-tournamental-ux-spec.md))
 * this is the single shared form-strip used in three places:
 *
 *  - inline under each flag in `MatchPredictionRow` (size="sm")
 *  - on the team-detail page (`/team/[code]`) (size="md")
 *  - on the upcoming-match preview pages
 *
 * Two render shapes:
 *
 *  - **`sm`** — 8px colour-only dots, no letter, ultra-compact. Designed
 *    for inline use under a flag. Five dots fit in ~52px wide and
 *    ~8px tall.
 *  - **`md`** — 14px circles with the W/D/L letter inside (white text).
 *    Used on the dedicated team page where context affords more room.
 *
 * Pure presentational — no data fetching. Caller passes the results in
 * **most-recent-first** order (matches the spec's `results` prop) and we
 * render oldest -> newest left to right so the UX matches the canonical
 * "form moves left to right through time" pattern from FlashScore +
 * FotMob (per [doc 35 §6](../../../../docs/35-competitor-ux-dossier.md#6-flashscore)).
 */

"use client";

import type { CSSProperties } from "react";

export type FormResult = "W" | "D" | "L";

export interface FormDotsProps {
  /** Most recent result first; up to 5 entries. Anything past 5 is dropped. */
  readonly results: readonly FormResult[];
  /** sm = 8px colour-only dots; md = 14px W/D/L pills. Default: "sm". */
  readonly size?: "sm" | "md";
  /**
   * Optional accessible label override. Defaults to a screen-reader summary
   * such as "Last 5 results: Win, Win, Draw, Loss, Win".
   */
  readonly ariaLabel?: string;
  readonly className?: string;
}

const RESULT_LABEL: Record<FormResult, string> = {
  W: "Win",
  D: "Draw",
  L: "Loss",
};

// Spec colours from doc 36.
const RESULT_COLOR: Record<FormResult, string> = {
  W: "#22c55e", // green
  D: "#94a3b8", // neutral
  L: "#ef4444", // red
};

const SIZE_PX: Record<"sm" | "md", number> = {
  sm: 8,
  md: 14,
};

export function FormDots(props: FormDotsProps) {
  const { results, size = "sm", ariaLabel, className = "" } = props;
  if (results.length === 0) {
    return null;
  }

  // Trim to 5, then reverse so oldest is leftmost (newest rightmost).
  const trimmed = results.slice(0, 5);
  const ordered = [...trimmed].reverse();

  const dim = SIZE_PX[size];
  const summary =
    ariaLabel ??
    `Last ${trimmed.length} result${trimmed.length === 1 ? "" : "s"}: ${trimmed
      .map((r) => RESULT_LABEL[r])
      .join(", ")}`;

  return (
    <ol
      className={`fd-row fd-${size} ${className}`}
      role="group"
      aria-label={summary}
      data-size={size}
    >
      {ordered.map((r, i) => {
        const style: CSSProperties = {
          width: dim,
          height: dim,
          backgroundColor: RESULT_COLOR[r],
        };
        return (
          <li key={i} className="fd-cell">
            <span
              className={`fd-dot fd-dot-${r.toLowerCase()}`}
              style={style}
              aria-hidden="true"
              data-result={r}
              title={RESULT_LABEL[r]}
            >
              {size === "md" ? r : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
