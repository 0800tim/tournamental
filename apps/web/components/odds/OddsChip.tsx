/**
 * OddsChip, inline pill showing W/D/L probabilities for one match.
 *
 * Default rendering: `MEX 52% · D 25% · KOR 23%` (group), or
 * `MEX 60% · KOR 40%` (knockout, no draw).
 *
 * The chip is wrapped in a `.wrap` container that also hosts the
 * `<OddsHoverCard>`. Hover/focus opens the card via CSS; on touch
 * devices a long-press toggles `data-open="true"` on the card so it
 * stays open until the user taps elsewhere.
 *
 * Accessibility:
 *  - `role="button"`, `tabIndex={0}` so keyboard users can focus the
 *    chip; focusing reveals the hover card via `:focus-within`.
 *  - `aria-describedby` points at the popover id.
 *  - `aria-label` is the full "Home X%, Draw Y%, Away Z%" sentence so
 *    screen readers don't have to parse the visual pill.
 */

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useMatchOdds } from "@/lib/odds/hooks";
import { mockOddsHistory } from "@/lib/odds/mock";
import type { OddsHistoryPoint } from "@/lib/odds/types";

import { OddsHoverCard } from "./OddsHoverCard";
import styles from "./OddsChip.module.css";

export interface OddsChipProps {
  readonly matchNo: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly homeLabel?: string;
  readonly awayLabel?: string;
  readonly noDraw?: boolean;
  readonly groupLabel?: string;
  readonly kickoffIso?: string;
  /** Cloudflare-derived 2-letter country, gates the affiliate CTA. */
  readonly country?: string | null;
  /** Surface tag passed to affiliate-click analytics. */
  readonly source?: string;
  /** When false, render the chip but skip the network call (used by
   * tests + storybook). */
  readonly fetchEnabled?: boolean;
  /** When true, render nothing until real (non-mock) odds resolve.
   * Used on knockout cards so we don't surface FIFA-rank placeholder
   * probabilities for matches whose slots are still predicted. */
  readonly hideWhenMock?: boolean;
}

const LONG_PRESS_MS = 500;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function OddsChip(props: OddsChipProps) {
  const {
    matchNo,
    homeTeam,
    awayTeam,
    homeLabel,
    awayLabel,
    noDraw,
    groupLabel,
    kickoffIso,
    country,
    source,
    fetchEnabled = true,
    hideWhenMock = false,
  } = props;

  const popoverId = useId();
  const { data, tier, loading, error } = useMatchOdds({
    matchNo,
    homeTeam,
    awayTeam,
    noDraw,
    enabled: fetchEnabled,
  });

  // Mobile: long-press toggles open. We track open state imperatively
  // so we can also close on outside tap.
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>): void => {
    if (e.pointerType !== "touch") return;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, LONG_PRESS_MS);
  };
  const cancelPress = (): void => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((v) => !v);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Lazy: only generate the sparkline points if we have data.
  const history: readonly OddsHistoryPoint[] = useMemo(() => {
    if (!data) return [];
    return mockOddsHistory(matchNo, data, 14).points;
  }, [data, matchNo]);

  // Knockout cards opt into hiding while data is still placeholder, so
  // we don't surface FIFA-rank fallbacks for matches whose slots are
  // still predicted. Reveal as soon as a real (non-mock) source arrives.
  if (hideWhenMock && (!data || data.source.startsWith("mock-"))) {
    return null;
  }

  // Fallback team labels if the parent didn't pass full names.
  const hLabel = homeLabel ?? homeTeam;
  const aLabel = awayLabel ?? awayTeam;

  // --- Body of the chip ---
  let chipBody: React.ReactNode;
  let ariaLabel: string;
  let dataState: "ok" | "loading" | "error" = "ok";

  if (error && !data) {
    chipBody = <span aria-hidden="true">- -</span>;
    ariaLabel = "Live odds unavailable";
    dataState = "error";
  } else if (!data) {
    chipBody = <span aria-hidden="true">·· %</span>;
    ariaLabel = "Loading live odds";
    dataState = "loading";
  } else if (data.draw === null) {
    chipBody = (
      <>
        <span className={styles.chipPart}>
          <span className={`${styles.chipDot} ${styles.chipPartHome}`} />
          <span className={styles.chipPartHome}>{homeTeam}</span>
          <span className={styles.chipPct}>{pct(data.homeWin)}</span>
        </span>
        <span className={styles.chipSep} aria-hidden="true">·</span>
        <span className={styles.chipPart}>
          <span className={`${styles.chipDot} ${styles.chipPartAway}`} />
          <span className={styles.chipPartAway}>{awayTeam}</span>
          <span className={styles.chipPct}>{pct(data.awayWin)}</span>
        </span>
      </>
    );
    ariaLabel = `Live odds: ${hLabel} ${pct(data.homeWin)}, ${aLabel} ${pct(data.awayWin)}`;
  } else {
    chipBody = (
      <>
        <span className={styles.chipPart}>
          <span className={`${styles.chipDot} ${styles.chipPartHome}`} />
          <span className={styles.chipPartHome}>{homeTeam}</span>
          <span className={styles.chipPct}>{pct(data.homeWin)}</span>
        </span>
        <span className={styles.chipSep} aria-hidden="true">·</span>
        <span className={styles.chipPart}>
          <span className={`${styles.chipDot} ${styles.chipPartDraw}`} />
          <span className={styles.chipPartDraw}>D</span>
          <span className={styles.chipPct}>{pct(data.draw)}</span>
        </span>
        <span className={styles.chipSep} aria-hidden="true">·</span>
        <span className={styles.chipPart}>
          <span className={`${styles.chipDot} ${styles.chipPartAway}`} />
          <span className={styles.chipPartAway}>{awayTeam}</span>
          <span className={styles.chipPct}>{pct(data.awayWin)}</span>
        </span>
      </>
    );
    ariaLabel = `Live odds: ${hLabel} ${pct(data.homeWin)}, draw ${pct(data.draw)}, ${aLabel} ${pct(data.awayWin)}`;
  }

  return (
    <span
      ref={wrapRef}
      className={styles.wrap}
      data-odds-chip-wrap=""
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
    >
      <span
        role="button"
        tabIndex={0}
        className={styles.chip}
        data-state={dataState}
        data-tier={tier ?? "loading"}
        data-loading={loading || undefined}
        data-match-no={matchNo}
        aria-label={ariaLabel}
        aria-describedby={data ? popoverId : undefined}
        aria-expanded={open || undefined}
        onKeyDown={onKeyDown}
      >
        {chipBody}
      </span>
      {data && (
        <OddsHoverCard
          id={popoverId}
          odds={data}
          homeLabel={hLabel}
          awayLabel={aLabel}
          kickoffIso={kickoffIso}
          groupLabel={groupLabel}
          country={country}
          open={open}
          history={history}
          source={source}
        />
      )}
    </span>
  );
}
