/**
 * PunditBadge, visual signal for Verified-Pundit users.
 *
 * Shown next to a user's handle on:
 *   - Leaderboard rows (LeaderboardPreview, mid-tournament leaderboard)
 *   - Bracket page header (when viewing your own bracket)
 *   - Customer-360 in admin (Profile tab)
 *   - Match-share OG card (via @vtorn/social-cards)
 *
 * Design rules:
 *   - Subtle. No animation. The badge is a brand-trust signal, not a
 *     hero element, it sits next to the username and is read passively.
 *   - Tooltip-on-hover spells out the qualifier and the level count.
 *   - Renders nothing when the user is not verified, caller passes the
 *     full `PunditStatus` payload (verified/levels/sinceDate/tournaments)
 *     fetched from `GET /v1/users/:userId/pundit`.
 */

import { CSSProperties } from "react";

export interface PunditStatus {
  readonly verified: boolean;
  readonly levels: number;
  readonly sinceDate: string | null;
  readonly tournaments: ReadonlyArray<string>;
}

export interface PunditBadgeProps {
  readonly status: PunditStatus | null | undefined;
  /** Pixel size of the circular badge (defaults to 14, small inline). */
  readonly size?: number;
  /** Optional className for the wrapper. */
  readonly className?: string;
  /** Optional style overrides for the wrapper. */
  readonly style?: CSSProperties;
}

const GOLD_RING = "#c9a21f";
const GOLD_FILL = "#f1c84b";
const GOLD_INK = "#1f1604";

export function PunditBadge({
  status,
  size = 14,
  className,
  style,
}: PunditBadgeProps) {
  if (!status || !status.verified) return null;

  const since = status.sinceDate
    ? new Date(status.sinceDate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
      })
    : "earlier this season";
  const levels = status.levels;
  const tip = `Verified Pundit, top 100 in ${levels} tournament${
    levels === 1 ? "" : "s"
  } since ${since}`;

  return (
    <span
      role="img"
      aria-label={tip}
      title={tip}
      data-testid="pundit-badge"
      data-pundit-levels={levels}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: GOLD_FILL,
        boxShadow: `inset 0 0 0 1px ${GOLD_RING}`,
        color: GOLD_INK,
        flex: "0 0 auto",
        verticalAlign: "middle",
        ...style,
      }}
    >
      <svg
        viewBox="0 0 12 12"
        width={Math.max(8, size * 0.62)}
        height={Math.max(8, size * 0.62)}
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M2.4 6.2 L4.8 8.5 L9.6 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {levels >= 2 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            transform: `translate(${size * 0.3}px, -${size * 0.55}px)`,
            background: "#1a2238",
            color: "#fff",
            fontSize: Math.max(8, Math.round(size * 0.55)),
            lineHeight: 1,
            padding: "1px 4px",
            borderRadius: 999,
            fontWeight: 700,
          }}
        >
          {levels}
        </span>
      )}
    </span>
  );
}
