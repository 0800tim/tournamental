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
import { MOCK_SYNDICATES } from "@/lib/mock/syndicate";

export type LeaderboardTabScope = LeaderboardAudienceScope | "mypools";

/** Audience filter: which set of competitors am I looking at? */
const TABS: ReadonlyArray<{
  readonly id: LeaderboardTabScope;
  readonly label: string;
}> = [
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
  { id: "mypools", label: "My Pools" },
];

/** Comparison scope: who am I comparing against inside the audience?
 *  Previously these lived in the AppShell subHeader as a pill row.
 *  Tim 2026-06-07 folded them into the leaderboard card so all the
 *  filter controls sit next to the list they filter. */
type LeaderboardCompareScope = "global" | "friends" | "country";

const COMPARE_SCOPES: ReadonlyArray<{
  readonly id: LeaderboardCompareScope;
  readonly label: string;
}> = [
  { id: "global", label: "Global" },
  { id: "friends", label: "Friends" },
  { id: "country", label: "Country" },
];

export interface LeaderboardTabsProps {
  readonly initialScope?: LeaderboardTabScope;
}

export function LeaderboardTabs({
  initialScope = "humans",
}: LeaderboardTabsProps): JSX.Element {
  const [scope, setScope] = useState<LeaderboardTabScope>(initialScope);
  const [compare, setCompare] = useState<LeaderboardCompareScope>("global");
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
      {/* Comparison scope (Global / Friends / Country). Sits above the
        * audience row because it's the wider filter — "compare me to
        * Friends" vs "compare me to the world" applies regardless of
        * whether you're looking at Humans, Bots, or your own Pools.
        * Tim 2026-06-07. */}
      <div
        role="tablist"
        aria-label="Leaderboard comparison scope"
        className="vt-lb-compare-tablist"
      >
        {COMPARE_SCOPES.map((s) => {
          const selected = s.id === compare;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className="vt-lb-compare-tab"
              data-active={selected ? "1" : undefined}
              onClick={() => setCompare(s.id)}
            >
              {s.label}
            </button>
          );
        })}
      </div>

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
 * "My Pools" tab body. Lists each pool the user is in with their
 * current rank inside it + a "View pool →" link to `/s/<slug>` so the
 * user can drill into the full pool board, members list, and pool
 * settings. Until the `/api/v1/leaderboard/my-pools` endpoint ships
 * (Phase 1 Task 8), we render the first three mock syndicates as the
 * user's joined pools so the link target and copy can be reviewed
 * in dev. Tim 2026-06-07.
 *
 * The shape is deliberately tiny so the eventual fetch lands in one
 * diff: a list of `{ slug, name, rank, members }`.
 */
function MyPoolsList() {
  // Preview shape: the user's first three mock pools, with a fabricated
  // rank derived from their handle index so the row reads as a
  // standings entry rather than a directory link.
  const myPools = MOCK_SYNDICATES.slice(0, 3).map((p, i) => ({
    slug: p.slug,
    name: p.name,
    members: p.memberCount,
    myRank: 3 + i * 7,
  }));

  if (myPools.length === 0) {
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

  return (
    <section className="vt-lb-mypools" aria-live="polite">
      <ul className="vt-lb-mypools-list">
        {myPools.map((p) => (
          <li key={p.slug} className="vt-lb-mypools-row">
            <div className="vt-lb-mypools-row-main">
              <span className="vt-lb-mypools-rank" aria-label={`Your rank ${p.myRank}`}>
                #{p.myRank}
              </span>
              <div className="vt-lb-mypools-meta">
                <span className="vt-lb-mypools-name">{p.name}</span>
                <span className="vt-lb-mypools-members">
                  {p.members.toLocaleString()} members
                </span>
              </div>
            </div>
            <a
              href={`/s/${encodeURIComponent(p.slug)}`}
              className="vt-lb-mypools-view"
              aria-label={`View ${p.name} pool`}
            >
              View pool <span aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="vt-lb-mypools-footnote">
        Want to start another? <a href="/syndicates/new" className="vt-lb-mypools-link">Create a Pool</a>
        {" · "}
        Browse <a href="/pools" className="vt-lb-mypools-link">all public Pools</a>.
      </p>
    </section>
  );
}
