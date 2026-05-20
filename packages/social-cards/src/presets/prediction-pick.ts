/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Preset: prediction-pick
 *
 * Fires when a user saves a single high-impact pick (e.g. picks an
 * underdog before kick-off). Lives at 1200x630 (landscape) and
 * 1080x1920 (story).
 *
 *   ───── PREDICTION · 2026-05-21 · @messi-fan
 *
 *   {User} *backs* {Team} to beat {Opponent}
 *                ^^^^^ italic gold
 *
 *   ─────────────────────────────────────────────
 *   {Odds %}   {Pick saved}   {Match no.}      play.tournamental.com/s/<slug>
 *
 * Returns the raw PNG bytes; the caller writes to disk / streams to
 * the response.
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

export interface PredictionPickArgs extends BasePresetArgs {
  /** User handle without the leading `@`. */
  userHandle: string;
  /** ISO-8601 date string (YYYY-MM-DD); rendered into the dateline. */
  pickedOn: string;
  /** Team the user is backing. */
  pickTeam: string;
  /** Opponent the user is calling against. */
  opponentTeam: string;
  /** Implied odds expressed as a percentage (0-100). */
  oddsPercent: number;
  /** Saved-pick count in the user's bracket so far. */
  picksSaved: number;
  /** Match number within the tournament (e.g. "Match 47 of 64"). */
  matchNumber: string;
  /** Pool / syndicate slug for the footer URL. */
  poolSlug: string;
}

export async function render(args: PredictionPickArgs): Promise<Buffer> {
  const size: Size = args.size ?? "og";
  const s = editorialScale(size);

  const userTag = `@${args.userHandle}`;
  const headlineText = `${userTag} backs ${args.pickTeam} to beat ${args.opponentTeam}`;
  const datelineText = `PREDICTION · ${args.pickedOn} · ${userTag}`;

  const tree = charcoalCanvas({
    size,
    children: [
      // Top band: gold ball + mono dateline
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
      // Middle: italic-gold emphasis on "backs"
      editorialHeadline(headlineText, size, { italic: "backs" }),
      // Bottom: 3-stat row + footer URL
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
                { value: `${Math.round(args.oddsPercent)}%`, label: "Odds" },
                { value: args.picksSaved, label: "Picks saved" },
                { value: args.matchNumber, label: "Match no." },
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
