/**
 * HeroKickoffTime, the kickoff strapline in the /match/[id]/preview
 * hero. Renders the kickoff in the viewer's local timezone after
 * hydration; falls back to UTC for the SSR/no-JS pass.
 *
 * Tim 2026-06-12: the preview page previously rendered every
 * viewer's kickoff in UTC formatted as en-NZ, so a UK viewer saw
 * "Thu, 11 Jun 2026, 19:00 UTC" instead of "Thu, 11 Jun, 20:00 BST".
 * The bracket modal + venue lozenge + calendar already did this
 * right; the preview page was the only outlier.
 */

"use client";

import { useEffect, useState } from "react";

export interface HeroKickoffTimeProps {
  /** ISO-8601 kickoff in UTC. */
  readonly kickoffUtc: string;
}

function format(iso: string, timezone: string, locale: string | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBD";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(d);
}

export function HeroKickoffTime({ kickoffUtc }: HeroKickoffTimeProps) {
  // SSR / first paint: render in UTC with a stable locale so server +
  // first client paint match. After mount, swap to the viewer's TZ.
  const ssrLabel = format(kickoffUtc, "UTC", "en-NZ");
  const [label, setLabel] = useState(ssrLabel);

  useEffect(() => {
    let tz = "UTC";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      // ignore
    }
    setLabel(format(kickoffUtc, tz, undefined));
  }, [kickoffUtc]);

  return (
    <time className="mp-kickoff" dateTime={kickoffUtc}>
      {label}
    </time>
  );
}
