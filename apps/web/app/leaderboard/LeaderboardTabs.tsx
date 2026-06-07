"use client";

/**
 * /leaderboard single-row tab strip.
 *
 * Five tabs in one row, in the order Tim signed off on 2026-06-07:
 *
 *   Humans     - prize-eligible competitors only.
 *   Bots       - the bot race, separately ranked.
 *   Global     - humans and bots merged into one ranking.
 *   Country    - humans filtered to the viewer's country.
 *   My Pools   - the user's own Pool memberships.
 *
 * Friends was dropped (no friends-graph in the database). Labels are
 * the bare words: the (humans), (bots), etc. parentheticals in Tim's
 * brief were just wiring hints for me, not user-facing copy.
 *
 * The strip drives one `<Leaderboard />` mount for the list-shaped
 * tabs (Humans / Bots / Global / Country) and a bespoke `MyPoolsList`
 * for the last one. Mock data flows in until the real
 * `/api/v1/leaderboard?audience=<...>` endpoint lands; the data shape
 * is the same so the swap is one fetcher line.
 *
 * Accessibility:
 *   - role="tablist" with role="tab" buttons.
 *   - aria-selected reflects active state.
 *   - keyboard nav: ArrowLeft / ArrowRight cycle, Home / End jump.
 *   - the rendered card below is implicitly the tabpanel; we name it
 *     via aria-controls + aria-labelledby so screen readers announce
 *     the relationship.
 *
 * Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
 */

import { useRef, useState, type KeyboardEvent } from "react";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { mockLeaderboardMembers, DEMO_MATCHES_PLAYED } from "@/lib/mock/leaderboard";
import { MOCK_SYNDICATES } from "@/lib/mock/syndicate";

export type LeaderboardTabId =
  | "humans"
  | "bots"
  | "global"
  | "country"
  | "mypools";

interface TabDef {
  readonly id: LeaderboardTabId;
  readonly label: string;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: "humans", label: "Humans" },
  { id: "bots", label: "Bots" },
  { id: "global", label: "Global" },
  { id: "country", label: "Country" },
  { id: "mypools", label: "My Pools" },
];

export interface LeaderboardTabsProps {
  readonly initialTab?: LeaderboardTabId;
}

export function LeaderboardTabs({
  initialTab = "humans",
}: LeaderboardTabsProps): JSX.Element {
  const [tab, setTab] = useState<LeaderboardTabId>(initialTab);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const wrapped = (index + TABS.length) % TABS.length;
    const next = TABS[wrapped];
    if (!next) return;
    setTab(next.id);
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
        aria-label="Leaderboard view"
        className="vt-lb-audience-tablist"
      >
        {TABS.map((t, i) => {
          const selected = t.id === tab;
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
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`vt-lb-panel-${tab}`}
        aria-labelledby={`vt-lb-tab-${tab}`}
        className="vt-lb-audience-panel"
      >
        {tab === "mypools" ? <MyPoolsList /> : <ScopedBoard tab={tab} />}
      </div>
    </div>
  );
}

/**
 * Renders one of the four list-shaped tabs (Humans / Bots / Global /
 * Country) via the existing `<Leaderboard />`. Wiring:
 *
 *   humans  -> audience=humans, mock rows seeded by "humans".
 *   bots    -> audience=bots, separate mock pool.
 *   global  -> humans + bots merged (mock: scope=null returns the
 *              combined pool).
 *   country -> humans only, country-filtered (mock: humans pool;
 *              the country filter will narrow it once the viewer's
 *              ISO country code is known server-side).
 *
 * All four are deterministic until kickoff (11 Jun 2026); the
 * `<DraftPreviewBanner />` above the page makes that clear.
 */
function ScopedBoard({
  tab,
}: {
  tab: Exclude<LeaderboardTabId, "mypools">;
}) {
  const wiring = (() => {
    switch (tab) {
      case "humans":
        return {
          title: "Humans leaderboard",
          members: mockLeaderboardMembers("humans", 50),
          scope: "humans" as const,
          showStreak: true,
          total: 24_388,
        };
      case "bots":
        return {
          title: "Bot leaderboard",
          members: mockLeaderboardMembers("bots", 50),
          scope: "bots" as const,
          showStreak: false,
          total: 18_000,
        };
      case "global":
        return {
          title: "Global leaderboard",
          members: mockLeaderboardMembers(null, 50),
          scope: undefined,
          showStreak: true,
          total: 24_388 + 18_000,
        };
      case "country":
        return {
          title: "Country leaderboard",
          members: mockLeaderboardMembers("humans", 50),
          scope: "humans" as const,
          showStreak: true,
          total: 24_388,
        };
    }
  })();

  return (
    <Leaderboard
      title={wiring.title}
      members={wiring.members}
      scope={wiring.scope}
      showStreakColumn={wiring.showStreak}
      totalMembers={wiring.total}
      matchesPlayed={DEMO_MATCHES_PLAYED}
      tabs={[]}
    />
  );
}

/**
 * "My Pools" tab body. Lists each pool the user is in with their
 * current rank inside it + a "View pool ->" link to `/s/<slug>` so the
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
              View pool <span aria-hidden="true">&rarr;</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="vt-lb-mypools-footnote">
        Want to start another?{" "}
        <a href="/syndicates/new" className="vt-lb-mypools-link">
          Create a Pool
        </a>
        {" · "}
        Browse{" "}
        <a href="/pools" className="vt-lb-mypools-link">
          all public Pools
        </a>
        .
      </p>
    </section>
  );
}
