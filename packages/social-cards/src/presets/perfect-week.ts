/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Preset: perfect-week
 *
 * Fires after a 7-day correct-pick streak. The headline reads as a
 * single editorial statement; the stat row carries the receipts.
 *
 *   ───── PERFECT WEEK · 2026-05-21
 *
 *   7 calls, *7 right*.
 *            ^^^^^^^^^ italic gold
 *
 *   ─────────────────────────────────────────────
 *   {Streak length}   {Matches called}   {Points earned}   play.tournamental.com/s/<slug>
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

export interface PerfectWeekArgs extends BasePresetArgs {
  /** User handle without the leading `@`. */
  userHandle: string;
  /** ISO-8601 date string (YYYY-MM-DD) of the week-ending day. */
  weekEnding: string;
  /** Current streak length in days (typically 7+ for this preset). */
  streakDays: number;
  /** Total matches called during the streak. */
  matchesCalled: number;
  /** Points earned during the streak. */
  pointsEarned: number;
  /** Pool / syndicate slug for the footer URL. */
  poolSlug: string;
}

export async function render(args: PerfectWeekArgs): Promise<Buffer> {
  const size: Size = args.size ?? "og";
  const s = editorialScale(size);

  // Editorial copy: "7 calls, 7 right." with the second clause in
  // italic gold. We render the matches-called count in the headline
  // rather than hard-coding 7 so the preset works for longer streaks
  // ("14 calls, 14 right.").
  const italicFragment = `${args.matchesCalled} right`;
  const headlineText = `${args.matchesCalled} calls, ${italicFragment}.`;
  const datelineText = `PERFECT WEEK · ${args.weekEnding}`;

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
      editorialHeadline(headlineText, size, { italic: italicFragment }),
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
                { value: `${args.streakDays}d`, label: "Streak" },
                { value: args.matchesCalled, label: "Matches called" },
                {
                  value: formatPoints(args.pointsEarned),
                  label: "Points earned",
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
