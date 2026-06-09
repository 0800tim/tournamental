"use client";

/**
 * Shows a time primarily in the viewer's own timezone, with the host-city
 * time in brackets underneath, e.g.
 *   Fri 12 Jun, 7:00 AM NZST
 *   (1:00 PM local · Estadio Azteca)
 *
 * The viewer's timezone is only known in the browser, so until the
 * component mounts (SSR + first client paint) it renders the host-city
 * text as the single primary line. After mount it swaps the viewer's time
 * to the top and drops the host-city text into the bracket line. Rendering
 * the same host-city line on the server and the first client paint avoids a
 * hydration mismatch; the swap is a normal post-mount state update.
 */

import { useEffect, useState } from "react";

export function LocalTime({
  iso,
  localText,
}: {
  iso: string;
  localText: string;
}): JSX.Element {
  const [yourTime, setYourTime] = useState<string | null>(null);

  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    try {
      const time = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(d);
      const tz =
        new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
          .formatToParts(d)
          .find((p) => p.type === "timeZoneName")?.value ?? "";
      setYourTime(tz ? `${time} ${tz}` : time);
    } catch {
      setYourTime(null);
    }
  }, [iso]);

  if (!yourTime) {
    return <span className="vt-oc-time-primary">{localText}</span>;
  }
  return (
    <>
      <span className="vt-oc-time-primary">{yourTime}</span>
      <span className="vt-oc-time-sub">({localText})</span>
    </>
  );
}
