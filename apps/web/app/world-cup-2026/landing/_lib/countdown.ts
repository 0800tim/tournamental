/**
 * Pure countdown math. Tested in vitest; no DOM, no React.
 *
 * Tournament starts 2026-06-11 19:00 UTC (first match: MEX vs RSA at the
 * Estadio Azteca; per `data/fifa-wc-2026/fixtures.json` match #1).
 */

export const TOURNAMENT_KICKOFF_UTC = "2026-06-11T19:00:00Z";

export interface CountdownParts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly totalMs: number;
  /** True if tournament has already started (totalMs <= 0). */
  readonly kickedOff: boolean;
}

export function countdownTo(targetIso: string, now: Date = new Date()): CountdownParts {
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) {
    throw new Error(`Invalid ISO datetime: ${targetIso}`);
  }
  const totalMs = Math.max(0, target - now.getTime());
  const kickedOff = target - now.getTime() <= 0;

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const days = Math.floor(totalMs / DAY);
  const hours = Math.floor((totalMs % DAY) / HOUR);
  const minutes = Math.floor((totalMs % HOUR) / MINUTE);
  const seconds = Math.floor((totalMs % MINUTE) / SECOND);

  return { days, hours, minutes, seconds, totalMs, kickedOff };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
