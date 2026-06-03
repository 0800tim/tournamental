"use client";

/**
 * SyndicateLeaderboardSection, wraps `<Leaderboard>` with the
 * syndicate-scoped tab set ("This pool / Global / Friends") and the
 * sticky DraftPreviewBanner. Drops straight into the /s/[guid] route.
 */

import { useMemo, useState } from "react";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import { mockLeaderboardMembers, DEMO_MATCHES_PLAYED } from "@/lib/mock/leaderboard";
import type { MockSyndicate } from "@/lib/mock/syndicate";

type Scope = "pool" | "global" | "friends";

export interface SyndicateLeaderboardSectionProps {
  readonly syndicate: MockSyndicate;
  /** Default scope; defaults to "pool". */
  readonly initialScope?: Scope;
}

export function SyndicateLeaderboardSection({
  syndicate,
  initialScope = "pool",
}: SyndicateLeaderboardSectionProps) {
  const [scope, setScope] = useState<Scope>(initialScope);

  const members = useMemo(() => {
    const seed =
      scope === "global"
        ? "global-leaderboard"
        : scope === "friends"
        ? `${syndicate.slug}-friends`
        : syndicate.slug;
    return mockLeaderboardMembers(seed, 30);
  }, [scope, syndicate.slug]);

  // "You" is row 7 in the syndicate scope, a believable place for a
  // first-week newcomer.
  const highlight = scope === "pool" ? members[6]?.id : undefined;

  return (
    <section className="vt-syn-section">
      <DraftPreviewBanner />
      <Leaderboard
        title={`${syndicate.name} leaderboard`}
        members={members}
        highlightMemberId={highlight}
        showMovementColumn
        showCountryColumn
        showStreakColumn
        density="comfortable"
        totalMembers={syndicate.memberCount}
        matchesPlayed={DEMO_MATCHES_PLAYED}
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
    </section>
  );
}
