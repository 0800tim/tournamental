/**
 * Live countdown timer to the WC 2026 kickoff.
 *
 * Renders a static (SSR) snapshot first so there's no layout shift, then a
 * client effect ticks once per second. Stops ticking once we're inside the
 * tournament window. Respects `prefers-reduced-motion` (no flashing on the
 * cells; the count just updates).
 */

"use client";

import { useEffect, useState } from "react";

import {
  countdownTo,
  pad2,
  TOURNAMENT_KICKOFF_UTC,
  type CountdownParts,
} from "../_lib/countdown";

export interface CountdownProps {
  /** Override the target kickoff time (defaults to 2026-06-11T19:00Z). */
  readonly targetIso?: string;
  /** SSR-snapshot date — supplied by the server component for stable HTML. */
  readonly initial: CountdownParts;
}

export function Countdown({
  targetIso = TOURNAMENT_KICKOFF_UTC,
  initial,
}: CountdownProps) {
  const [parts, setParts] = useState<CountdownParts>(initial);

  useEffect(() => {
    setParts(countdownTo(targetIso));
    const id = window.setInterval(() => {
      setParts(countdownTo(targetIso));
    }, 1000);
    return () => window.clearInterval(id);
  }, [targetIso]);

  return (
    <div
      className="wc-countdown"
      data-testid="wc-countdown"
      data-state={parts.kickedOff ? "kicked-off" : "ticking"}
      role="timer"
      aria-live="polite"
    >
      <Cell value={parts.days} label="days" />
      <Cell value={pad2(parts.hours)} label="hours" />
      <Cell value={pad2(parts.minutes)} label="mins" />
      <Cell value={pad2(parts.seconds)} label="secs" />
    </div>
  );
}

function Cell({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="wc-countdown-cell">
      <span className="wc-countdown-num" data-testid={`wc-countdown-${label}`}>
        {value}
      </span>
      <span className="wc-countdown-label">{label}</span>
    </span>
  );
}
