"use client";

/**
 * SyndicateLeaderboardSection, wraps `<Leaderboard>` with the
 * syndicate-scoped tab set ("This pool / Global / Friends") and the
 * sticky DraftPreviewBanner. Drops straight into the /s/[guid] route.
 *
 * Tim 2026-06-07: the "This pool" tab now fetches the real game
 * service leaderboard for this syndicate via
 * `fetchSyndicateLeaderboard`. The "Global" and "Friends" tabs are
 * still mock for now (no real friends graph and the global page is a
 * separate Day 1 wire). Once a fetch resolves the draft banner stays
 * visible for the non-pool tabs but drops for "This pool" so users see
 * a hard live list.
 */

import { useEffect, useMemo, useState } from "react";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import {
  mockLeaderboardMembers,
  DEMO_MATCHES_PLAYED,
  type MockMember,
} from "@/lib/mock/leaderboard";
import {
  fetchSyndicateLeaderboard,
  type LeaderboardRow,
} from "@/lib/leaderboard/fetch";
import type { MockSyndicate } from "@/lib/mock/syndicate";

const TOURNAMENT_ID = "fifa-wc-2026";

type Scope = "pool" | "global" | "friends";

export interface SyndicateLeaderboardSectionProps {
  readonly syndicate: MockSyndicate;
  /** Default scope; defaults to "pool". */
  readonly initialScope?: Scope;
}

/**
 * Map a real API row into the `MockMember` shape the `<Leaderboard>`
 * component already renders. Country / flag / streak aren't carried by
 * the API (yet); they fall back to neutral placeholders so the column
 * shows a globe + a hyphen rather than a layout shift.
 */
function rowToMember(r: LeaderboardRow): MockMember {
  return {
    id: r.bracket_id,
    handle: `@${r.user_handle}`,
    country: "",
    flag: "🌐",
    rank: r.rank,
    // Numerator is the count of correctly predicted match outcomes.
    // The multiplier-weighted `score_total` stays on the wire for
    // analytics but doesn't drive the X column.
    points: r.correct_picks,
    movement: 0,
    matchesAvailable: r.matches_available_to_user,
  };
}

export function SyndicateLeaderboardSection({
  syndicate,
  initialScope = "pool",
}: SyndicateLeaderboardSectionProps) {
  const [scope, setScope] = useState<Scope>(initialScope);

  // Real pool members + load state. Other tabs fall back to mock.
  const [poolMembers, setPoolMembers] = useState<readonly MockMember[] | null>(
    null,
  );
  const [poolError, setPoolError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetchSyndicateLeaderboard(
          TOURNAMENT_ID,
          syndicate.slug,
          ac.signal,
        );
        if (ac.signal.aborted) return;
        setPoolMembers(res.rows.map(rowToMember));
        setPoolError(null);
      } catch (err) {
        if (ac.signal.aborted) return;
        setPoolError(err instanceof Error ? err.message : "load_failed");
        setPoolMembers([]);
      }
    })();
    return () => ac.abort();
  }, [syndicate.slug]);

  const mockMembers = useMemo(() => {
    const seed =
      scope === "global"
        ? "global-leaderboard"
        : scope === "friends"
        ? `${syndicate.slug}-friends`
        : syndicate.slug;
    return mockLeaderboardMembers(seed, 30);
  }, [scope, syndicate.slug]);

  const isReal = scope === "pool" && poolMembers !== null;
  const members: readonly MockMember[] = isReal
    ? (poolMembers ?? [])
    : mockMembers;
  const isLoading = scope === "pool" && poolMembers === null && !poolError;

  // Pool-scope "you" highlight comes back in Day 2 once /v1/me/share-
  // guid lands; for now the leaderboard ships without it on the real
  // tab. Mock tabs keep their fake-self placement.
  const highlight =
    scope === "pool" ? undefined : mockMembers[6]?.id;

  return (
    <section className="vt-syn-section">
      {/* Banner stays visible for the still-mock global/friends tabs
        * so visitors don't think those numbers are live. Drops away
        * for the pool tab as soon as real rows land. */}
      {!isReal && <DraftPreviewBanner />}
      <Leaderboard
        title={`${syndicate.name} leaderboard`}
        members={members}
        highlightMemberId={highlight}
        showMovementColumn={!isReal /* mocks have synthetic movement */}
        showCountryColumn={!isReal /* until the API carries country */}
        showStreakColumn={!isReal}
        density="comfortable"
        totalMembers={syndicate.memberCount}
        matchesPlayed={isReal ? undefined : DEMO_MATCHES_PLAYED}
        skipSkeleton={!isLoading}
        tabs={[
          { id: "top50", label: "This pool" },
          { id: "this-week", label: "Global" },
          { id: "all-time", label: "Friends" },
        ]}
        activeTab={
          scope === "pool" ? "top50" : scope === "global" ? "this-week" : "all-time"
        }
        onTabChange={(id) =>
          setScope(id === "top50" ? "pool" : id === "this-week" ? "global" : "friends")
        }
      />
      {poolError && scope === "pool" && (
        <p style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>
          Couldn&apos;t load the live leaderboard ({poolError}). Showing
          empty for now; refresh to retry.
        </p>
      )}
    </section>
  );
}
