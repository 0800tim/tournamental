/*
 * Copyright 2026 Tournamental
 * Apache 2.0 (see LICENSE).
 */

/**
 * PoolLeaderboardLive, the auto-refreshing pool leaderboard on
 * /s/<slug>.
 *
 * Replaces the inline server-rendered <div className="vt-share-pool-lb">
 * block that used to live in apps/web/app/s/[guid]/page.tsx. The first
 * render is hydrated from the SSR-computed `initialRows` so the visible
 * standings appear instantly with the rest of the page; after mount the
 * component polls /api/v1/syndicates/<slug>/leaderboard every 30s and
 * re-renders when the response changes.
 *
 * Tim 2026-06-16: prior to this users had to pull-to-refresh to see
 * standings update after a match resulted, even though the server-side
 * leaderboard cache invalidated correctly. The CDN held the page HTML
 * for 60s and the browser didn't refetch.
 *
 * Polling cadence + tab-hide pause mirror the existing match-results
 * and live-status hooks. The component tolerates an offline window
 * silently — failed polls keep the previous rows; the next tick retries.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import { DEFAULT_AVATAR_DATA_URI } from "@/lib/profile/avatar";
import { slugifyDisplayName } from "@/lib/share/handle-slug";

export interface PoolLeaderboardLiveMember {
  readonly user_id: string | null;
  readonly handle: string;
  readonly display_name: string | null;
  readonly points: number;
  readonly flag_emoji: string;
  readonly avatar_url: string | null;
  readonly joined_at: string;
}

export interface PoolLeaderboardLiveProps {
  readonly slug: string;
  readonly initialRows: ReadonlyArray<PoolLeaderboardLiveMember>;
  readonly initialMatchesAvailable: number;
}

const POLL_INTERVAL_MS = 30_000;

interface RankedRow {
  readonly m: PoolLeaderboardLiveMember;
  readonly rank: number;
  readonly tied: boolean;
}

/**
 * Rank + tied calculation, same dense-rank logic the SSR page used to
 * carry inline. Members on equal points share a tier; the `=` suffix
 * shows only when a tier holds more than one row.
 */
function rankMembers(
  members: ReadonlyArray<PoolLeaderboardLiveMember>,
): ReadonlyArray<RankedRow> {
  const sorted = [...members].sort(
    (a, b) =>
      b.points - a.points || a.joined_at.localeCompare(b.joined_at),
  );
  const tierByPoints = new Map<number, number>();
  const countByTier = new Map<number, number>();
  let tier = 0;
  let prev: number | null = null;
  for (const m of sorted) {
    if (prev === null || m.points !== prev) {
      tier += 1;
      prev = m.points;
      tierByPoints.set(m.points, tier);
    }
    countByTier.set(tier, (countByTier.get(tier) ?? 0) + 1);
  }
  return sorted.map((m) => {
    const t = tierByPoints.get(m.points) ?? 0;
    return { m, rank: t, tied: (countByTier.get(t) ?? 0) > 1 };
  });
}

export function PoolLeaderboardLive(props: PoolLeaderboardLiveProps) {
  const { slug, initialRows, initialMatchesAvailable } = props;
  const [members, setMembers] = useState<
    ReadonlyArray<PoolLeaderboardLiveMember>
  >(initialRows);
  const [matchesAvailable, setMatchesAvailable] = useState<number>(
    initialMatchesAvailable,
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/leaderboard`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!r.ok) return;
        const body = (await r.json()) as {
          members?: ReadonlyArray<PoolLeaderboardLiveMember>;
          matches_available?: number;
        };
        if (cancelled || !body.members) return;
        setMembers(body.members);
        if (typeof body.matches_available === "number") {
          setMatchesAvailable(body.matches_available);
        }
      } catch {
        // Silent: the next tick retries; previous rows stay visible.
      }
    }
    // Don't fire on mount — SSR rows are already fresh. Wait one
    // interval before the first poll so the page is settled.
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
  }, [slug]);

  const ranked = useMemo(() => rankMembers(members), [members]);

  return (
    <div className="vt-share-pool-lb" role="list">
      <div className="vt-share-pool-lb-header" aria-hidden="true">
        <span className="vt-share-pool-lb-header-rank">Rank</span>
        <span className="vt-share-pool-lb-header-name">Member</span>
        {matchesAvailable > 0 && (
          <span className="vt-share-pool-lb-header-score">
            correct / resulted
          </span>
        )}
      </div>
      {ranked.map(({ m, rank, tied }) => (
        <PoolLeaderboardRow
          key={m.user_id ?? m.handle}
          m={m}
          rank={rank}
          tied={tied}
          matchesAvailable={matchesAvailable}
        />
      ))}
    </div>
  );
}

function PoolLeaderboardRow({
  m,
  rank,
  tied,
  matchesAvailable,
}: {
  m: PoolLeaderboardLiveMember;
  rank: number;
  tied: boolean;
  matchesAvailable: number;
}) {
  const label = m.display_name?.trim() || m.handle;
  const avatarSrc = m.avatar_url ?? DEFAULT_AVATAR_DATA_URI;
  const slug =
    slugifyDisplayName(m.display_name) ??
    slugifyDisplayName(m.handle) ??
    null;
  const isPermalinkUser = !!m.user_id && /^u_[0-9a-f]+$/i.test(m.user_id);
  const profileHref = slug
    ? `/s/${slug}`
    : isPermalinkUser
      ? `/s/${m.user_id}`
      : null;
  const inner = (
    <>
      <span className="vt-share-pool-lb-rank">
        {rank}
        {tied && <span className="vt-share-pool-lb-rank-eq">=</span>}
      </span>
      <span className="vt-share-pool-lb-avatar-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="vt-share-pool-lb-avatar"
          src={avatarSrc}
          alt=""
          width={128}
          height={128}
          loading="lazy"
        />
        {m.flag_emoji && (
          <span className="vt-share-pool-lb-flag" aria-hidden="true">
            {m.flag_emoji}
          </span>
        )}
      </span>
      <span className="vt-share-pool-lb-name">
        {label}
        {m.display_name && (
          <span className="vt-share-pool-lb-handle">@{m.handle}</span>
        )}
      </span>
      {matchesAvailable > 0 && (
        <span
          className="vt-share-pool-lb-score"
          aria-label={`${m.points} correct of ${matchesAvailable}`}
        >
          <span className="vt-share-pool-lb-score-x">{m.points}</span>
          <span className="vt-share-pool-lb-score-sep">/</span>
          <span className="vt-share-pool-lb-score-y">{matchesAvailable}</span>
        </span>
      )}
    </>
  );
  return profileHref ? (
    <a
      className="vt-share-pool-lb-row vt-share-pool-lb-row--link"
      href={profileHref}
      role="listitem"
      aria-label={`View ${label}'s bracket`}
    >
      {inner}
    </a>
  ) : (
    <div className="vt-share-pool-lb-row" role="listitem">
      {inner}
    </div>
  );
}
