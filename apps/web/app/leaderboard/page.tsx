"use client";

/**
 * /leaderboard, global prediction-IQ leaderboard.
 *
 * Phase 1 of the Open Bot Arena (spec §5) turned this page into a
 * three-tab surface:
 *   - Humans   (default landing tab, prize-eligible competitors)
 *   - Bots     (AI competitors, ranked separately; ineligible for cash)
 *   - My Pools (the user's own Pool memberships)
 *
 * The tab strip lives in the LeaderboardTabs client component, which
 * owns the active-scope state and renders the appropriate body. The
 * surrounding hero (kickoff countdown + brackets-locked tiles) and the
 * "You vs the pool" + "Pundits to follow" rails are shared across all
 * audience tabs so the page identity stays the same.
 *
 * Until the live picks DB starts ingesting at kickoff (2026-06-11),
 * this surface renders deterministic mock data via
 * `mockLeaderboardMembers(...)` and shows the DraftPreviewBanner + the
 * in-card "Preview data" footer chip. The data shape is intentionally
 * identical to what the real `/api/leaderboard?scope=<audience>`
 * endpoint will return; to go live, the LeaderboardTabs component
 * swaps its mock fetch for a server-side call.
 */

import { useEffect, useMemo, useState } from "react";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { PerfectTrackBadge } from "@/components/leaderboard/PerfectTrackBadge";
import { StageProgressChart } from "@/components/leaderboard/StageProgressChart";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import { DraftWatermark } from "@/components/mock/DraftWatermark";
import { AppShell } from "@/components/shell";
import { mockLeaderboardMembers, DEMO_MATCHES_PLAYED } from "@/lib/mock/leaderboard";
import {
  mockPointsHistory,
  mockPoolAverage,
} from "@/lib/mock/points-history";

import { LeaderboardTabs } from "./LeaderboardTabs";

import "./leaderboard.css";

export default function LeaderboardPage() {
  // Tim 2026-06-07: the Global/Friends/Country chooser used to live in
  // the AppShell subHeader pill row. It now sits inside the leaderboard
  // card next to the Humans/Bots/My Pools audience tabs, so the page
  // padding can compress and both decisions live next to the list they
  // filter.
  const members = useMemo(() => mockLeaderboardMembers(null, 50), []);

  // "You" pinned to mid-pack so the highlight row is visibly demoed in
  // the side rails.
  const youId = members[12]?.id;

  const heroStats = useMemo(
    () => [
      { value: "24,388", label: "humans locked in" },
      { value: "18,000", label: "bots competing" },
    ],
    [],
  );

  const memberSeries = useMemo(
    () => mockPointsHistory(youId ?? "you", 28),
    [youId],
  );
  const poolSeries = useMemo(
    () => mockPoolAverage(youId ?? "you", 28),
    [youId],
  );

  return (
    <AppShell title="Leaderboard">
      <div className="vt-page-content vt-lb-page">
        <DraftPreviewBanner />

        <PerfectTrackBadge />

        <section className="vt-lb-hero">
          {heroStats.map((s) => (
            <DraftWatermark key={s.label} tileWidth={180}>
              <article className="vt-lb-hero-card">
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </article>
            </DraftWatermark>
          ))}
          <DraftWatermark key="countdown" tileWidth={180}>
            <MiniCountdownTile />
          </DraftWatermark>
        </section>

        <section className="vt-lb-grid">
          <DraftWatermark>
            <LeaderboardTabs initialScope="humans" />
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

/**
 * Mini countdown tile, sits in the third slot of the leaderboard hero
 * row. Three cells (D / H / M) styled to match the home page's
 * countdown banner at tile-scale; no seconds, so a one-minute tick is
 * plenty and the SSR/CSR text-mismatch surface is much smaller. The
 * kickoff instant is the FIFA WC 2026 opener (2026-06-11T19:00:00Z,
 * Mexico City), the same target the home page uses.
 *
 * Tim 2026-06-05.
 */
function MiniCountdownTile() {
  const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);
  // Seed with the target so SSR + first client render agree; effect
  // snaps to wall-clock and ticks every minute (no seconds shown).
  const [now, setNow] = useState<number>(() => KICKOFF_MS);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, KICKOFF_MS - now);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000) % 24;
  const minutes = Math.floor(diff / 60_000) % 60;
  const live = diff === 0;

  return (
    <article className="vt-lb-hero-card vt-lb-hero-card--countdown" aria-live="polite">
      {live ? (
        <strong>Live</strong>
      ) : (
        <div className="vt-lb-mini-countdown">
          <MiniCell value={days} label="Days" />
          <MiniCell value={hours} label="Hrs" />
          <MiniCell value={minutes} label="Min" />
        </div>
      )}
      <span>to kickoff</span>
    </article>
  );
}

function MiniCell({ value, label }: { value: number; label: string }) {
  const padded = String(Math.max(0, value)).padStart(2, "0");
  return (
    <div className="vt-lb-mini-countdown-cell">
      {/* SSR-seeded `now` equals the target until hydration, so the
        * server emits "00" for every cell and the client patches to
        * the real values on first effect run. Suppress the expected
        * text-mismatch on just this node. */}
      <span className="vt-lb-mini-countdown-num" suppressHydrationWarning>
        {padded}
      </span>
      <span className="vt-lb-mini-countdown-label">{label}</span>
    </div>
  );
}
