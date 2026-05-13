"use client";

/**
 * Full-width banner showing days/hours/minutes/seconds until a target
 * UTC instant. Ticks once per second; honours `prefers-reduced-motion`
 * by lowering the tick rate to once per minute.
 *
 * When the target is in the past, the banner shows zeroes and renders
 * the optional `pastLabel` instead of the eyebrow.
 */

import { useEffect, useState } from "react";

export interface CountdownBannerProps {
  readonly targetUtc: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly pastLabel?: string;
}

interface Parts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly elapsed: boolean;
}

export function computeParts(targetMs: number, nowMs: number): Parts {
  const diff = targetMs - nowMs;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, elapsed: true };
  }
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / (1000 * 60)) % 60;
  const hours = Math.floor(diff / (1000 * 60 * 60)) % 24;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return { days, hours, minutes, seconds, elapsed: false };
}

export function CountdownBanner({
  targetUtc,
  title,
  eyebrow = "Tournament countdown",
  pastLabel = "Tournament is live",
}: CountdownBannerProps) {
  const targetMs = Date.parse(targetUtc);
  const [now, setNow] = useState<number>(() =>
    Number.isFinite(targetMs) ? Date.now() : 0,
  );

  useEffect(() => {
    if (!Number.isFinite(targetMs)) return undefined;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = reduced ? 60_000 : 1_000;
    const id = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(id);
  }, [targetMs]);

  if (!Number.isFinite(targetMs)) {
    return null;
  }

  const parts = computeParts(targetMs, now);

  return (
    <section className="vt-countdown" aria-live="polite">
      <div className="vt-countdown-head">
        <p className="vt-countdown-eyebrow">{parts.elapsed ? pastLabel : eyebrow}</p>
        <h2 className="vt-countdown-title">{title}</h2>
      </div>
      <div className="vt-countdown-grid">
        <Cell value={parts.days} label="Days" />
        <Cell value={parts.hours} label="Hrs" />
        <Cell value={parts.minutes} label="Min" />
        <Cell value={parts.seconds} label="Sec" />
      </div>
    </section>
  );
}

function Cell({ value, label }: { value: number; label: string }) {
  const padded = String(Math.max(0, value)).padStart(2, "0");
  return (
    <div className="vt-countdown-cell">
      <span className="vt-countdown-num">{padded}</span>
      <span className="vt-countdown-label">{label}</span>
    </div>
  );
}
