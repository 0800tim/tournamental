"use client";

/**
 * /leaderboard tab triplet: Humans / Bots / My Pools.
 *
 * Phase 1 of the Open Bot Arena (spec §5) introduced an audience tab
 * on the leaderboard so the prize-eligible race (Humans) is the
 * default landing, the bot race is one tap away, and the user's own
 * Pools are one tap further. The tab strip itself is a tiny stateful
 * client component; the heavy <Leaderboard /> card renders only the
 * currently-selected scope so we avoid mounting three copies of the
 * skeleton-then-list animation.
 *
 * Accessibility:
 *   - role="tablist" wraps role="tab" buttons.
 *   - aria-selected reflects active state.
 *   - keyboard nav: ArrowLeft / ArrowRight cycle, Home / End jump.
 *   - the rendered card below is implicitly the tabpanel; we name it
 *     via `aria-controls` + `aria-labelledby` so screen readers
 *     announce the relationship.
 *
 * Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
 */

import { useRef, useState, type KeyboardEvent } from "react";

import {
  Leaderboard,
  type LeaderboardAudienceScope,
} from "@/components/leaderboard/Leaderboard";
import { mockLeaderboardMembers, DEMO_MATCHES_PLAYED } from "@/lib/mock/leaderboard";

export type LeaderboardTabScope = LeaderboardAudienceScope | "mypools";

const TABS: ReadonlyArray<{
  readonly id: LeaderboardTabScope;
  readonly label: string;
}> = [
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
  { id: "mypools", label: "My Pools" },
];

export interface LeaderboardTabsProps {
  readonly initialScope?: LeaderboardTabScope;
}

export function LeaderboardTabs({
  initialScope = "humans",
}: LeaderboardTabsProps): JSX.Element {
  const [scope, setScope] = useState<LeaderboardTabScope>(initialScope);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const wrapped = (index + TABS.length) % TABS.length;
    const next = TABS[wrapped];
    if (!next) return;
    setScope(next.id);
    const btn = buttonsRef.current[wrapped];
    btn?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusTab(0);
        break;
      case "End":
        e.preventDefault();
        focusTab(TABS.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="vt-lb-audience">
      <div
        role="tablist"
        aria-label="Leaderboard audience"
        className="vt-lb-audience-tablist"
      >
        {TABS.map((t, i) => {
          const selected = t.id === scope;
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttonsRef.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`vt-lb-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`vt-lb-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className="vt-lb-audience-tab"
              data-active={selected ? "1" : undefined}
              onClick={() => setScope(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`vt-lb-panel-${scope}`}
        aria-labelledby={`vt-lb-tab-${scope}`}
        className="vt-lb-audience-panel"
      >
        {scope === "mypools" ? (
          <MyPoolsList />
        ) : (
          <ScopedBoard scope={scope} />
        )}
      </div>
    </div>
  );
}

/**
 * The Humans / Bots boards both reuse the existing `<Leaderboard>`
 * component. Until the real `/api/v1/leaderboard?scope=...` endpoint is
 * live (game-service side, Tasks 5 + 8 of the Phase 1 plan), we render
 * deterministic mock rows seeded by the audience name so each tab
 * shows a different leaderboard. The shape matches what the live API
 * will return, so the swap is a one-line change at the data fetcher.
 */
function ScopedBoard({ scope }: { scope: LeaderboardAudienceScope }) {
  const members = mockLeaderboardMembers(scope, 50);
  return (
    <Leaderboard
      title={scope === "bots" ? "Bot leaderboard" : "Global leaderboard"}
      members={members}
      scope={scope}
      showStreakColumn={scope === "humans"}
      totalMembers={scope === "bots" ? 18_000 : 24_388}
      matchesPlayed={DEMO_MATCHES_PLAYED}
      tabs={[]}
    />
  );
}

/**
 * "My Pools" tab body. When the user has Pool memberships, lists each
 * with the user's current rank inside that Pool. Placeholder copy
 * stands in until the `/api/v1/leaderboard/my-pools` endpoint ships
 * (Phase 1 Task 8). The shape is deliberately tiny here so the eventual
 * fetch can land in one diff: a list of `{ slug, name, rank, members }`.
 */
function MyPoolsList() {
  return (
    <section className="vt-lb-mypools" aria-live="polite">
      <p className="vt-lb-mypools-empty">
        You aren&apos;t in any Pools yet. Pools are friend-and-family
        leaderboards: pick a name, share a link, and the people who join
        race against each other inside their own bracket. Browse the{" "}
        <a href="/pools" className="vt-lb-mypools-link">
          public Pools directory
        </a>{" "}
        or{" "}
        <a href="/syndicates/new" className="vt-lb-mypools-link">
          start your own
        </a>
        .
      </p>
    </section>
  );
}
