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

import { useCountUp } from "@/lib/motion";

export interface SyndicateLeaderboardRow {
  readonly handle: string;
  readonly points: number;
  readonly flag_emoji: string;
}

export interface SyndicateLeaderboardRowsProps {
  readonly rows: ReadonlyArray<SyndicateLeaderboardRow>;
}

export function SyndicateLeaderboardRows({
  rows,
}: SyndicateLeaderboardRowsProps) {
  return (
    <ol className="vt-share-leaderboard" aria-label="Leaderboard top 5">
      {rows.map((m, i) => (
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
