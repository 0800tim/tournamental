/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Preset: syndicate-invite
 *
 * Generic share card for a syndicate pool. Mirrors the visual grammar
 * of `apps/web/app/api/og/syndicate/route.ts` (the canonical reference)
 * but lives in the social-cards package so non-Next.js consumers
 * (Telegram bot, marketing build, CDN warm-up scripts) can render the
 * same image.
 *
 *   ───── FWC2026 · @owner_handle
 *
 *   {Pool name}
 *   (Fraunces; long names auto-shrink via editorial taper)
 *
 *   ─────────────────────────────────────────────
 *   {Members}   {Picks made}   {Entry fee | Free}   play.tournamental.com/s/<slug>
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

export interface SyndicateInviteArgs extends BasePresetArgs {
  /** Pool / syndicate slug for the footer URL. */
  poolSlug: string;
  /** Display name; auto-shrinks for long titles. */
  poolName: string;
  /** Owner handle without the leading `@`. */
  ownerHandle: string;
  /** Current member count. */
  memberCount: number;
  /** Total picks made across the pool. */
  picksMade: number;
  /**
   * Entry fee shown in the third stat cell. Pass a string (e.g.
   * "$5", "0.01 ETH") or `null` to render "Free".
   */
  entryFee?: string | null;
}

export async function render(args: SyndicateInviteArgs): Promise<Buffer> {
  const size: Size = args.size ?? "og";
  const s = editorialScale(size);

  const datelineText = `FWC2026 · @${args.ownerHandle}`;
  const memberLabel = args.memberCount === 1 ? "Member" : "Members";
  const picksLabel = args.picksMade === 1 ? "Pick made" : "Picks made";
  const feeValue =
    args.entryFee === null || args.entryFee === undefined || args.entryFee === ""
      ? "Free"
      : args.entryFee;

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
      // No italic-gold fragment on the headline: the pool name reads
      // as a single editorial statement (per the syndicate OG ref).
      editorialHeadline(args.poolName, size),
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
                { value: formatCount(args.memberCount), label: memberLabel },
                { value: formatCount(args.picksMade), label: picksLabel },
                { value: feeValue, label: "Entry fee" },
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

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}
