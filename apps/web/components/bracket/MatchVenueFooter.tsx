/**
 * MatchVenueFooter, the neutral charcoal lozenge that sits at the
 * bottom of each match row in place of the old "Add score" toggle.
 *
 * Renders: weekday + date + middle-dot + user-local kickoff time +
 * short timezone abbreviation in parens + a small gold info icon.
 *
 * Whole lozenge is a single tap target. When the bracket's overlay
 * router is mounted (the common case inside `/world-cup-2026`), the
 * click opens the existing `MatchOverlay` bottom sheet for this
 * match. Outside the bracket shell (tests, standalone match-preview
 * page) the underlying `<a>` falls through to a regular navigation
 * to `/match/{id}/preview`.
 *
 * SSR / hydration: the first render uses the venue's IANA timezone
 * so the server output is deterministic. After mount, a `useEffect`
 * reads the user's resolved timezone (`Intl.DateTimeFormat()
 * .resolvedOptions().timeZone`) and re-renders with that. The DOM
 * structure is identical pre/post hydration, only the formatted
 * text changes, which React tolerates.
 */

"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { useOptionalOverlay } from "@/components/overlay/OverlayProvider";

import type { HostCity } from "@/lib/host-cities";

export interface MatchVenueFooterProps {
  readonly matchId: string;
  readonly homeName: string;
  readonly awayName: string;
  /** ISO-8601 kickoff time in UTC, e.g. "2026-06-11T19:00:00Z". */
  readonly kickoffIso: string;
  /** Resolved host-city record. When absent (defensive), the lozenge
   * falls back to UTC formatting. */
  readonly hostCity?: HostCity;
}

interface FormattedKickoff {
  readonly dateLabel: string;
  readonly timeLabel: string;
}

function formatKickoff(
  iso: string,
  timezone: string,
  locale?: string,
): FormattedKickoff {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { dateLabel: "TBD", timeLabel: "TBD" };
  }
  // `undefined` locale lets Intl resolve to the runtime locale; the
  // explicit `locale` argument is for the SSR pre-hydration pass
  // where we want a stable, deterministic output.
  const loc = locale;
  const dateLabel = new Intl.DateTimeFormat(loc, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(d);
  const timeLabel = new Intl.DateTimeFormat(loc, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(d);
  return { dateLabel, timeLabel };
}

function resolveUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function MatchVenueFooter(props: MatchVenueFooterProps) {
  const { matchId, homeName, awayName, kickoffIso, hostCity } = props;
  const overlay = useOptionalOverlay();

  // SSR / first-render pass: use the venue timezone (deterministic
  // across server + client). After mount, switch to the user's
  // resolved timezone via Intl. The venue fallback also covers the
  // rare case where Intl can't resolve a user timezone.
  const ssrTimezone = hostCity?.timezone ?? "UTC";
  const ssrLocale = "en-US";
  const [timezone, setTimezone] = useState<string>(ssrTimezone);
  const [locale, setLocale] = useState<string | undefined>(ssrLocale);

  useEffect(() => {
    setTimezone(resolveUserTimezone());
    // `undefined` here = use the runtime-resolved locale.
    setLocale(undefined);
  }, []);

  const { dateLabel, timeLabel } = formatKickoff(kickoffIso, timezone, locale);
  const ariaLabel =
    `View match details for ${homeName} vs ${awayName}, ` +
    `kicks off ${dateLabel}, ${timeLabel}`;

  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (!overlay) return; // let the <a> navigate normally
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return; // user wants a new tab / etc., honour it
    }
    e.preventDefault();
    overlay.open("match", { id: matchId });
  };

  return (
    <a
      href={`/match/${matchId}/preview`}
      className="mpr-venue-footer"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
    >
      <span className="mpr-venue-footer-text">
        <span className="mpr-venue-footer-date">{dateLabel}</span>
        <span className="mpr-venue-footer-sep" aria-hidden="true">·</span>
        <span className="mpr-venue-footer-time">{timeLabel}</span>
      </span>
      <InfoIcon className="mpr-venue-footer-info" />
    </a>
  );
}

interface InfoIconProps {
  readonly className?: string;
}

function InfoIcon(props: InfoIconProps) {
  return (
    <svg
      className={props.className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="7" cy="4.2" r="0.85" fill="currentColor" />
      <rect x="6.25" y="6" width="1.5" height="4.4" rx="0.6" fill="currentColor" />
    </svg>
  );
}
