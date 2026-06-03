"use client";

/**
 * /leaderboard, global prediction-IQ leaderboard.
 *
 * Until the live picks DB starts ingesting at kickoff (2026-06-11),
 * this surface renders deterministic mock data via
 * `mockLeaderboardMembers(null, 50)` and shows the DraftPreviewBanner
 * + the in-card "Preview data" footer chip. The shape of the data
 * is intentionally identical to what the real `/api/leaderboard`
 * endpoint will return, to go live, replace the
 * `mockLeaderboardMembers(...)` call with a server-side fetch and
 * drop both the banner and the watermark wrappers.
 */

import { useEffect, useMemo, useState } from "react";

import {
  Leaderboard,
  type LeaderboardScope,
} from "@/components/leaderboard/Leaderboard";
import { StageProgressChart } from "@/components/leaderboard/StageProgressChart";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import { DraftWatermark } from "@/components/mock/DraftWatermark";
import { AppShell, PillTabs } from "@/components/shell";
import { mockLeaderboardMembers, DEMO_MATCHES_PLAYED } from "@/lib/mock/leaderboard";
import {
  mockPointsHistory,
  mockPoolAverage,
} from "@/lib/mock/points-history";

import "./leaderboard.css";

export default function LeaderboardPage() {
  const [tab, setTab] = useState<"global" | "friends" | "country">("global");
  const [scope, setScope] = useState<LeaderboardScope>("top50");

  const members = useMemo(() => mockLeaderboardMembers(null, 50), []);

  // "You" pinned to mid-pack so the highlight row is visibly demoed.
  const youId = members[12]?.id;

  // Days-to-kickoff is a live countdown to the FIFA WC 2026 opening
  // match (2026-06-11T19:00:00Z, Mexico City). Initialised to `null` so
  // SSR doesn't disagree with the client's clock; the post-mount effect
  // fills it in and refreshes every minute so leaving the tab open
  // across midnight still reads correctly. Tim 2026-06-04 caught it
  // stuck on the original hardcoded "31 days" demo value.
  const [daysToKickoff, setDaysToKickoff] = useState<number | null>(null);
  useEffect(() => {
    const kickoffMs = Date.UTC(2026, 5, 11, 19, 0, 0);
    const recompute = () => {
      const remaining = Math.ceil((kickoffMs - Date.now()) / 86_400_000);
      setDaysToKickoff(Math.max(0, remaining));
    };
    recompute();
    const timer = setInterval(recompute, 60_000);
    return () => clearInterval(timer);
  }, []);

  const kickoffLabel = useMemo(() => {
    if (daysToKickoff === null) return "Soon";
    if (daysToKickoff === 0) return "Live";
    if (daysToKickoff === 1) return "1 day";
    return `${daysToKickoff} days`;
  }, [daysToKickoff]);

  const heroStats = useMemo(
    () => [
      { value: "24,388", label: "brackets locked" },
      { value: "1,204", label: "syndicates running" },
      { value: kickoffLabel, label: "to kickoff" },
    ],
    [kickoffLabel],
  );

  // For the "you vs the pool" chart, seed from the highlighted member.
  const memberSeries = useMemo(
    () => mockPointsHistory(youId ?? "you", 28),
    [youId],
  );
  const poolSeries = useMemo(
    () => mockPoolAverage(youId ?? "you", 28),
    [youId],
  );

  return (
    <AppShell
      title="Leaderboard"
      subHeader={
        <PillTabs
          ariaLabel="Leaderboard scope"
          tabs={[
            { id: "global", label: "Global" },
            { id: "friends", label: "Friends" },
            { id: "country", label: "Country" },
          ]}
          active={tab}
          onChange={(id) => setTab(id as typeof tab)}
        />
      }
    >
      <div className="vt-page-content vt-lb-page">
        <DraftPreviewBanner />

        <section className="vt-lb-hero">
          {heroStats.map((s) => (
            <DraftWatermark key={s.label} tileWidth={180}>
              <article className="vt-lb-hero-card">
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </article>
            </DraftWatermark>
          ))}
        </section>

        <section className="vt-lb-grid">
          <DraftWatermark>
            <Leaderboard
              title="Global leaderboard"
              members={members}
              highlightMemberId={youId}
              showStreakColumn
              activeTab={scope}
              onTabChange={setScope}
              totalMembers={24388}
              matchesPlayed={DEMO_MATCHES_PLAYED}
            />
          </DraftWatermark>

          <aside className="vt-lb-side">
            <DraftWatermark>
              <article className="vt-lb-card vt-lb-chart-card">
                <header className="vt-lb-header">
                  <div className="vt-lb-header-row">
                    <h3 className="vt-lb-title">You vs the pool</h3>
                  </div>
                </header>
                <div className="vt-lb-chart-wrap">
                  <StageProgressChart
                    memberSeries={memberSeries}
                    poolSeries={poolSeries}
                  />
                </div>
                <footer className="vt-lb-footer">
                  <span>Cumulative points by match-day</span>
                  <span>Preview data</span>
                </footer>
              </article>
            </DraftWatermark>

            <Leaderboard
              title="Pundits to follow"
              members={members}
              badgeFilter="pundit"
              showMovementColumn={false}
              showCountryColumn
              density="comfortable"
              tabs={[]}
              matchesPlayed={DEMO_MATCHES_PLAYED}
            />
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
