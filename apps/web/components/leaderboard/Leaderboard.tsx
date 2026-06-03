"use client";

/**
 * Leaderboard, the polished, social ranking card.
 *
 * One component drives three places:
 *   1. /leaderboard, global, 50 rows, all columns.
 *   2. Syndicate landing, same shape, syndicate-scoped tabs.
 *   3. Bracket builder right-rail, density="compact", top 10.
 *
 * The component is data-agnostic, it accepts `members: MockMember[]`
 * today, but the shape is intentionally identical to what we expect
 * from the real `/api/leaderboard` endpoint. To swap mock for real,
 * the caller changes a single import; no changes here.
 *
 * Visual contract:
 *   - Rank pills: gold/silver/bronze for top 3 with glow; slate else.
 *   - Avatar 36×36 with a flag corner badge.
 *   - "YOU" pill + gold-gradient highlight row when highlightMemberId matches.
 *   - Pundit/creator/owner badges as small chips.
 *   - Optional sparkline of recent points (deterministic via member id).
 *   - 800ms skeleton on first mount so transitions feel snappy.
 *
 * Mobile (<640px): country + streak + sparkline collapse out; rank +
 * avatar + handle + points always present.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { pickAvatar } from "@/lib/mock/avatar";
import type { MockMember } from "@/lib/mock/leaderboard";
import { mockPointsHistory } from "@/lib/mock/points-history";

import { PointsSparkline } from "./PointsSparkline";

import "./leaderboard.css";

export type LeaderboardScope = "top50" | "this-week" | "all-time";

export interface LeaderboardTab {
  readonly id: LeaderboardScope;
  readonly label: string;
}

export interface LeaderboardProps {
  /** "Global leaderboard" or "<Syndicate> leaderboard". */
  readonly title: string;
  /** Pre-sorted by `rank`. */
  readonly members: readonly MockMember[];
  /** When set, the matching row is highlighted with a "YOU" pill. */
  readonly highlightMemberId?: string;
  readonly showMovementColumn?: boolean;
  readonly showCountryColumn?: boolean;
  readonly showStreakColumn?: boolean;
  readonly showSparkline?: boolean;
  /** Default "comfortable"; "compact" is for the right-rail use. */
  readonly density?: "comfortable" | "compact";
  /** Show the "Preview data" badge wired through the tab bar. Default true. */
  readonly draftMark?: boolean;
  /** For the footer: "Showing 50 of 24,388". */
  readonly totalMembers?: number;
  /** Custom tabs; defaults to Top 50 / This week / All time. */
  readonly tabs?: readonly LeaderboardTab[];
  readonly activeTab?: LeaderboardScope;
  readonly onTabChange?: (id: LeaderboardScope) => void;
  /** Matches played so far in the tournament. When set, rows render
   *  their points as "X/{matchesPlayed}" (one point per correct match
   *  prediction, the live scoring model) and a "Current standings
   *  after N matches" subtitle appears under the title. */
  readonly matchesPlayed?: number;
  /** Optional filter for badge type, e.g. show pundits only. */
  readonly badgeFilter?: MockMember["badge"];
  /** Optional extra content rendered at the top of the card body. */
  readonly headerExtras?: ReactNode;
  /** Disable the initial skeleton (useful for snapshot tests). */
  readonly skipSkeleton?: boolean;
}

const DEFAULT_TABS: readonly LeaderboardTab[] = [
  { id: "top50", label: "Top 50" },
  { id: "this-week", label: "This week" },
  { id: "all-time", label: "All time" },
];

export function Leaderboard({
  title,
  members,
  highlightMemberId,
  showMovementColumn = true,
  showCountryColumn = true,
  showStreakColumn = false,
  showSparkline = true,
  density = "comfortable",
  draftMark = true,
  totalMembers,
  tabs = DEFAULT_TABS,
  activeTab = "top50",
  onTabChange,
  matchesPlayed,
  badgeFilter,
  headerExtras,
  skipSkeleton = false,
}: LeaderboardProps) {
  const [loading, setLoading] = useState(!skipSkeleton);

  useEffect(() => {
    if (skipSkeleton) return;
    const t = window.setTimeout(() => setLoading(false), 800);
    return () => window.clearTimeout(t);
  }, [skipSkeleton]);

  const rows = useMemo(() => {
    return badgeFilter
      ? members.filter((m) => m.badge === badgeFilter)
      : members;
  }, [members, badgeFilter]);

  return (
    <section
      className="vt-lb-card"
      data-density={density}
      data-draft={draftMark ? "1" : undefined}
      aria-label={title}
    >
      <header className="vt-lb-header">
        <div className="vt-lb-header-row">
          <div className="vt-lb-title-block">
            <h3 className="vt-lb-title">{title}</h3>
            {typeof matchesPlayed === "number" && matchesPlayed > 0 && (
              <p className="vt-lb-subtitle">
                Current standings after {matchesPlayed}{" "}
                {matchesPlayed === 1 ? "match" : "matches"}
              </p>
            )}
          </div>
          {tabs.length > 0 && (
            <div className="vt-lb-tabs" role="tablist" aria-label={`${title} scope`}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="vt-lb-tab"
                  role="tab"
                  aria-selected={t.id === activeTab}
                  onClick={() => onTabChange?.(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* "Share my rank" CTA renders when the caller passed a YOU id and
          * the row is in view. Doc 24 §Sharing names leaderboard_climbed
          * as a top-3 viral surface. We extract the data from `members`
          * server-side and bounce navigator.share via /leaderboard/share
          * which carries OG meta for unfurl previews (Tim 2026-05-22). */}
        {highlightMemberId && rows.find((r) => r.id === highlightMemberId) && (
          <ShareMyRankButton
            member={rows.find((r) => r.id === highlightMemberId)!}
            totalMembers={totalMembers ?? rows.length}
          />
        )}
        {headerExtras}
      </header>

      {loading ? (
        <SkeletonRows count={Math.min(8, rows.length || 8)} />
      ) : rows.length === 0 ? (
        <div className="vt-lb-empty">
          {badgeFilter
            ? `No ${badgeFilter}s in the rankings yet.`
            : "No rankings yet. Check back at kickoff."}
        </div>
      ) : (
        <ol className="vt-lb-list">
          {rows.map((m) => (
            <LeaderboardRow
              key={m.id}
              member={m}
              highlight={m.id === highlightMemberId}
              showMovement={showMovementColumn}
              showCountry={showCountryColumn}
              showStreak={showStreakColumn}
              showSparkline={showSparkline}
              matchesPlayed={matchesPlayed}
            />
          ))}
        </ol>
      )}

      <footer className="vt-lb-footer">
        <span>
          {totalMembers
            ? `Showing ${rows.length.toLocaleString()} of ${totalMembers.toLocaleString()}`
            : `Showing ${rows.length.toLocaleString()} members`}
        </span>
        {draftMark && <span>Preview data</span>}
      </footer>
    </section>
  );
}

interface LeaderboardRowProps {
  readonly member: MockMember;
  readonly highlight: boolean;
  readonly showMovement: boolean;
  readonly showCountry: boolean;
  readonly showStreak: boolean;
  readonly showSparkline: boolean;
  readonly matchesPlayed?: number;
}

function LeaderboardRow({
  member,
  highlight,
  showMovement,
  showCountry,
  showStreak,
  showSparkline,
  matchesPlayed,
}: LeaderboardRowProps) {
  const m = member;
  const avatarSrc = pickAvatar(m.handle);
  const sparkStamps = useMemo(
    () => mockPointsHistory(m.id, 7),
    [m.id],
  );

  return (
    <li
      className="vt-lb-row"
      data-rank={m.rank}
      data-highlight={highlight ? "1" : undefined}
    >
      <span className="vt-lb-rank" aria-label={`Rank ${m.rank}`}>
        {m.rank}
      </span>
      <span className="vt-lb-avatar-wrap">
        <img
          className="vt-lb-avatar"
          src={avatarSrc}
          alt=""
          width={36}
          height={36}
          loading="lazy"
        />
        <span className="vt-lb-flag" aria-hidden="true">
          {m.flag}
        </span>
      </span>
      <span className="vt-lb-id">
        <span className="vt-lb-handle">
          {m.handle}
          {highlight && <span className="vt-lb-you-pill">YOU</span>}
          {m.badge && (
            <span className="vt-lb-badge" data-kind={m.badge}>
              {badgeLabel(m.badge)}
            </span>
          )}
        </span>
        <span className="vt-lb-meta">
          {showCountry && (
            <span className="vt-lb-country">{m.country}</span>
          )}
          {showStreak && m.streakDays && m.streakDays > 1 && (
            <span className="vt-lb-streak">🔥 {m.streakDays}d streak</span>
          )}
        </span>
      </span>
      {showSparkline && (
        <PointsSparkline
          stamps={sparkStamps}
          ariaLabel={`${m.handle} recent points`}
        />
      )}
      <span className="vt-lb-rhs">
        <span
          className="vt-lb-points"
          aria-label={
            typeof matchesPlayed === "number"
              ? `${m.points} correct out of ${matchesPlayed}`
              : `${m.points} points`
          }
        >
          {typeof matchesPlayed === "number" && matchesPlayed > 0 ? (
            <>
              {m.points}
              <span className="vt-lb-points-denom">/{matchesPlayed}</span>
            </>
          ) : (
            m.points.toLocaleString()
          )}
        </span>
        {showMovement && (
          <MovementIndicator value={m.movement} />
        )}
      </span>
    </li>
  );
}

function MovementIndicator({ value }: { value: number }) {
  const dir: "up" | "down" | "flat" = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const glyph = dir === "up" ? "▲" : dir === "down" ? "▼" : "·";
  const label =
    dir === "up"
      ? `Up ${value} positions`
      : dir === "down"
      ? `Down ${Math.abs(value)} positions`
      : "No change";
  return (
    <span className="vt-lb-movement" data-dir={dir} aria-label={label}>
      <span aria-hidden="true">{glyph}</span>
      <span>{value === 0 ? "" : Math.abs(value)}</span>
    </span>
  );
}

function badgeLabel(b: NonNullable<MockMember["badge"]>): string {
  switch (b) {
    case "pundit":
      return "🎙 Pundit";
    case "creator":
      return "Creator";
    case "syndicate-owner":
      return "Owner";
  }
}

function ShareMyRankButton({
  member,
  totalMembers,
}: {
  member: MockMember;
  totalMembers: number;
}) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (typeof window === "undefined") return;
    setBusy(true);
    try {
      const percentile = Math.max(
        1,
        Math.min(100, Math.round((member.rank / Math.max(1, totalMembers)) * 100)),
      );
      const params = new URLSearchParams();
      params.set("handle", member.handle);
      params.set("rank", String(member.rank));
      params.set("points", String(member.points));
      params.set("percentile", String(percentile));
      params.set("scope", "GLOBAL");
      const url = `https://play.tournamental.com/leaderboard/share?${params.toString()}`;
      const text = `I'm #${member.rank} on the Tournamental Football World Cup 2026 leaderboard. Catch me ⬇`;
      try {
        const w = window as Window & { dataLayer?: Array<Record<string, unknown>> };
        if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
        w.dataLayer.push({
          event: "share_clicked",
          platform: "native",
          surface: "leaderboard-rank",
        });
      } catch {
        /* analytics best-effort */
      }
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (typeof nav.share === "function") {
        await nav.share({ title: "My Tournamental rank", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        window.alert("Link copied to clipboard!");
      }
    } catch {
      /* user cancelled or share failed; non-fatal */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="vt-lb-share-rank"
      onClick={onClick}
      disabled={busy}
      aria-label="Share my rank"
    >
      <span aria-hidden="true">↗</span> {busy ? "Sharing…" : "Share my rank"}
    </button>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <ul className="vt-lb-skeleton" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li className="vt-lb-skeleton-row" key={i}>
          <span className="vt-lb-skeleton-block vt-lb-skeleton-circle" />
          <span className="vt-lb-skeleton-block vt-lb-skeleton-circle" style={{ width: 36, height: 36 }} />
          <span className="vt-lb-skeleton-block" style={{ width: `${50 + ((i * 11) % 30)}%` }} />
          <span className="vt-lb-skeleton-block" style={{ width: 36 }} />
        </li>
      ))}
    </ul>
  );
}
