"use client";

/**
 * Full-width banner showing days/hours/minutes/seconds until a target
 * UTC instant. Ticks once per second; honours `prefers-reduced-motion`
 * by lowering the tick rate to once per minute.
 *
 * When the target is in the past, the banner shows zeroes and renders
 * the optional `pastLabel` instead of the eyebrow.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

export interface CountdownBannerProps {
  readonly targetUtc: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly pastLabel?: string;
  /**
   * Tim 2026-06-05: when true, suppresses the head (eyebrow + title)
   * and renders only the digit grid. Used on the home page where the
   * countdown sits inline next to the stats row and the head would be
   * redundant. Defaults to false so existing callers are unaffected.
   */
  readonly compact?: boolean;
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
  compact = false,
}: CountdownBannerProps) {
  const t = useTranslations();
  const targetMs = Date.parse(targetUtc);
  // Seed `now` with `targetMs` (a stable, deterministic value) so the
  // server and the client's first render produce identical HTML. We
  // bump it to the real Date.now() inside useEffect, AFTER hydration,
  // so React doesn't see a mismatch. Without this seed every render
  // logged "Text content did not match. Server: '07' Client: '06'" on
  // the home page (Tim 2026-06-02).
  const [now, setNow] = useState<number>(() =>
    Number.isFinite(targetMs) ? targetMs : 0,
  );

  useEffect(() => {
    if (!Number.isFinite(targetMs)) return undefined;
    // Snap to the real wall-clock the moment we hydrate.
    setNow(Date.now());
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
    <section
      className={compact ? "vt-countdown vt-countdown--compact" : "vt-countdown"}
      aria-live="polite"
    >
      {!compact && (
        <div className="vt-countdown-head">
          <p className="vt-countdown-eyebrow">{parts.elapsed ? pastLabel : eyebrow}</p>
          <h2 className="vt-countdown-title">{title}</h2>
        </div>
      )}
      <div className="vt-countdown-grid">
        <Cell value={parts.days}    label={safeT(t, "countdown.unit_days",    "Days")} dataKey="day" />
        <Cell value={parts.hours}   label={safeT(t, "countdown.unit_hours",   "Hrs")}  dataKey="hr" />
        <Cell value={parts.minutes} label={safeT(t, "countdown.unit_minutes", "Min")}  dataKey="min" />
        <Cell value={parts.seconds} label={safeT(t, "countdown.unit_seconds", "Sec")}  dataKey="sec" />
      </div>
    </section>
  );
}

function Cell({
  value,
  label,
  dataKey,
}: {
  value: number;
  label: string;
  dataKey: string;
}) {
  const padded = String(Math.max(0, value)).padStart(2, "0");
  return (
    <div className="vt-countdown-cell" data-key={dataKey}>
      {/* The countdown is computed from Date.now() at render, so the SSR
          value and the client-hydration value differ by the elapsed seconds.
          Suppress the inevitable text mismatch so React patches this one node
          instead of bailing the whole root to client rendering. */}
      <span className="vt-countdown-num" suppressHydrationWarning>
        {padded}
      </span>
      <span className="vt-countdown-label">{label}</span>
    </div>
  );
}
