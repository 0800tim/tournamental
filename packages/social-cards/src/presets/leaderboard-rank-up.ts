/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Preset: leaderboard-rank-up
 *
 * Fires when a user climbs a rank. Highlights the new position in big
 * Fraunces gold; the stat row carries the points, streak, and hit-rate
 * context so the share still reads in a single glance.
 *
 *   ───── LEADERBOARD · @kiri
 *
 *   Moved to position 87.
 *                     ^^ italic gold rank
 *
 *   ─────────────────────────────────────────────
 *   {Points}    {Streak}    {Hit rate}      play.tournamental.com/s/<slug>
 */

import {
  charcoalCanvas,
  dateline,
  editorialHeadline,
  editorialScale,
  footerUrl,
  goldBall,
  tabularStatRow,
  type Size,
} from "../editorial.js";
import { poolUrlLabel } from "../theme.js";
import { rasterisePreset, type BasePresetArgs } from "./_render.js";

export interface LeaderboardRankUpArgs extends BasePresetArgs {
  /** User handle without the leading `@`. */
  userHandle: string;
  /** New rank position the user has just climbed to. */
  newRank: number;
  /** Points earned this season / pool. */
  points: number;
  /** Current correct-pick streak in days. */
  streakDays: number;
  /** Hit-rate as a percentage (0-100). */
  hitRatePercent: number;
  /** Pool / syndicate slug for the footer URL. */
  poolSlug: string;
}

export async function render(args: LeaderboardRankUpArgs): Promise<Buffer> {
  const size: Size = args.size ?? "og";
  const s = editorialScale(size);

  const userTag = `@${args.userHandle}`;
  const rankString = `${args.newRank}`;
  const headlineText = `Moved to position ${rankString}.`;
  const datelineText = `LEADERBOARD · ${userTag}`;

  const tree = charcoalCanvas({
    size,
    children: [
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            alignItems: "center",
            gap: Math.round(24 * s.scale),
          },
          children: [goldBall(s.ballSize), dateline(datelineText, { size })],
        },
      },
      // Italic gold on the rank number — the number is the headline.
      editorialHeadline(headlineText, size, { italic: rankString }),
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: s.rowGap,
          },
          children: [
            tabularStatRow(
              [
                { value: formatPoints(args.points), label: "Points" },
                { value: `${args.streakDays}d`, label: "Streak" },
                {
                  value: `${Math.round(args.hitRatePercent)}%`,
                  label: "Hit rate",
                },
              ],
              size,
            ),
            footerUrl(poolUrlLabel(args.poolSlug), size),
          ],
        },
      },
    ],
  });

  return rasterisePreset({ tree, size });
}

function formatPoints(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}
