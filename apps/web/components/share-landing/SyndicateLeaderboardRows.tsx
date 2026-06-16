/*
 * Copyright 2026 Tournamental
 *
 * Licensed under the Apache Licence, Version 2.0 (the "Licence");
 * you may not use this file except in compliance with the Licence.
 * You may obtain a copy of the Licence at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * SyndicateLeaderboardRows, client wrapper around the syndicate share-
 * landing's top-five leaderboard so the numeric points column count-ups
 * when the section scrolls into view.
 *
 * The parent route (`/s/[guid]`) is a server component; this child takes
 * the static rows and threads each `points` number through the shared
 * `useCountUp` hook from `@/lib/motion`. Markup mirrors the server-
 * rendered shape exactly so SSR + hydration agree.
 *
 * Reduced motion + zero-points handling lives in the hook; this file
 * only wires the data.
 */

"use client";

import { useEffect, useState } from "react";

import { useCountUp } from "@/lib/motion";

export interface SyndicateLeaderboardRow {
  readonly handle: string;
  readonly points: number;
  readonly flag_emoji: string;
}

export interface SyndicateLeaderboardRowsProps {
  readonly rows: ReadonlyArray<SyndicateLeaderboardRow>;
  /**
   * Pool slug used to poll /api/v1/syndicates/<slug>/leaderboard every
   * 30s so viewers see the standings update after a match results
   * without pulling-to-refresh. Optional for back-compat with callers
   * that haven't been migrated yet (they keep the static SSR rows).
   *
   * Tim 2026-06-16.
   */
  readonly slug?: string;
  /**
   * Cap on rendered rows. Defaults to the length of the SSR `rows` prop
   * so a "top 5" leaderboard stays "top 5" after a poll refresh.
   */
  readonly maxRows?: number;
}

const POLL_INTERVAL_MS = 30_000;

export function SyndicateLeaderboardRows({
  rows,
  slug,
  maxRows,
}: SyndicateLeaderboardRowsProps) {
  const cap = maxRows ?? rows.length;
  const [liveRows, setLiveRows] = useState<
    ReadonlyArray<SyndicateLeaderboardRow>
  >(rows);

  // Tim 2026-06-16: poll the BFF every 30s so the standings update
  // within ~30..60s of a match-result POST (the client poll cadence
  // plus the BFF's 10s edge-cache TTL). No refresh required.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug as string)}/leaderboard`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!r.ok) return;
        const body = (await r.json()) as {
          members?: ReadonlyArray<{
            handle: string;
            points: number;
            flag_emoji: string;
          }>;
        };
        if (cancelled || !body.members) return;
        // Trim to the same row count the SSR delivered; the BFF returns
        // every member ranked, callers display only the top N.
        const next = body.members.slice(0, cap).map((m) => ({
          handle: m.handle,
          points: m.points,
          flag_emoji: m.flag_emoji,
        }));
        setLiveRows(next);
      } catch {
        // Silent — keep showing the previous rows; next tick retries.
      }
    }
    // Don't fire on mount because SSR already produced fresh data;
    // wait one interval before the first poll.
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug, cap]);

  return (
    <ol className="vt-share-leaderboard" aria-label="Leaderboard top 5">
      {liveRows.map((m, i) => (
        <LeaderboardRow key={m.handle} rank={i + 1} member={m} />
      ))}
    </ol>
  );
}

function LeaderboardRow({
  rank,
  member,
}: {
  rank: number;
  member: SyndicateLeaderboardRow;
}) {
  // One tween per row; ScrollTrigger fires per element so a long list
  // staggers naturally as it crosses the fold. Tabular nums + Fraunces
  // are owned by `.vt-share-leaderboard-pts` in share-landing.css.
  const ref = useCountUp<HTMLSpanElement>({ value: member.points });
  return (
    <li className="vt-share-leaderboard-row" data-rank={rank}>
      <span className="vt-share-leaderboard-rank">{rank}</span>
      <span className="vt-share-leaderboard-flag" aria-hidden>
        {member.flag_emoji}
      </span>
      <span className="vt-share-leaderboard-handle">@{member.handle}</span>
      <span
        ref={ref as React.RefObject<HTMLSpanElement>}
        className="vt-share-leaderboard-pts"
      >
        {member.points}
      </span>
    </li>
  );
}
