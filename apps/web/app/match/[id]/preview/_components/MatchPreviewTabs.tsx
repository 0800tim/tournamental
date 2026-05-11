/**
 * MatchPreviewTabs, client-side tab strip for /match/[id]/preview.
 *
 * Owns the active-tab state. Reflects the active tab into the URL hash
 * (#predict / #h2h / #form / #lineup / #stats) so each tab is shareable.
 *
 * Accessibility:
 *   - tablist / tab / tabpanel ARIA roles wired correctly.
 *   - Arrow Left / Right cycles tabs (typical pattern; see WAI-ARIA
 *     Authoring Practices "Tabs" example).
 *   - Home / End jump to first / last.
 *   - Each panel hidden when not active (`hidden` attribute) so screen
 *     readers don't see content from inactive tabs.
 *
 * Mobile: the tablist is horizontally scrollable via overflow-x: auto +
 * inline-flex children; tap targets ≥ 44px.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { MatchPrediction, Team } from "@tournamental/bracket-engine";

import { PredictTab } from "./PredictTab";
import { HeadToHeadTab } from "./HeadToHeadTab";
import { FormTab } from "./FormTab";
import { LineupTab } from "./LineupTab";
import { StatsTab } from "./StatsTab";

import type {
  ExpectedScoreline,
  H2HRecord,
  ResolvedMatch,
  TeamFormation,
  TeamStats,
} from "../_lib/match-data";
import type { FormGame } from "../../../../team/[code]/_lib/team-data";

export const TAB_IDS = ["predict", "h2h", "form", "lineup", "stats"] as const;
export type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<TabId, string> = {
  predict: "Predict",
  h2h: "H2H",
  form: "Form",
  lineup: "Lineup",
  stats: "Stats",
};

export interface MatchPreviewTabsProps {
  readonly match: ResolvedMatch;
  readonly homeTeam: Team | null;
  readonly awayTeam: Team | null;
  readonly homeName: string;
  readonly awayName: string;
  readonly homeForm: readonly FormGame[];
  readonly awayForm: readonly FormGame[];
  readonly h2h: H2HRecord | null;
  readonly homeLineup: TeamFormation | null;
  readonly awayLineup: TeamFormation | null;
  readonly homeStats: TeamStats | null;
  readonly awayStats: TeamStats | null;
  readonly expected: ExpectedScoreline | null;
}

function readHash(): TabId {
  if (typeof window === "undefined") return "predict";
  const raw = window.location.hash.replace(/^#/, "").toLowerCase();
  return (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : "predict";
}

export function MatchPreviewTabs(props: MatchPreviewTabsProps) {
  const {
    match,
    homeTeam,
    awayTeam,
    homeName,
    awayName,
    homeForm,
    awayForm,
    h2h,
    homeLineup,
    awayLineup,
    homeStats,
    awayStats,
    expected,
  } = props;

  const [active, setActive] = useState<TabId>("predict");
  const [prediction, setPrediction] = useState<MatchPrediction | undefined>(undefined);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    predict: null,
    h2h: null,
    form: null,
    lineup: null,
    stats: null,
  });

  // Sync from initial hash + listen for hashchange (back/forward nav).
  useEffect(() => {
    setActive(readHash());
    const onHash = (): void => setActive(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Hydrate the local prediction draft from localStorage so a user who
  // already picked this match in the bracket sees their pick reflected
  // here. The bracket page is the source of truth; this is a read-only
  // mirror until they interact with the row.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`vtorn:bracket:fifa-wc-2026`);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        matchPredictions?: Record<string, MatchPrediction>;
        knockoutPredictions?: Record<string, MatchPrediction>;
      };
      const merged: Record<string, MatchPrediction> = {
        ...(draft.matchPredictions ?? {}),
        ...(draft.knockoutPredictions ?? {}),
      };
      const existing = merged[match.matchId];
      if (existing) setPrediction(existing);
    } catch {
      /* localStorage may be unavailable (SSR, privacy mode), ignore. */
    }
  }, [match.matchId]);

  const setTab = useCallback((next: TabId): void => {
    setActive(next);
    if (typeof window !== "undefined") {
      // Use replaceState rather than direct hash assign so we don't
      // smash the back-button history with every tab switch.
      const url = new URL(window.location.href);
      url.hash = next;
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = TAB_IDS.indexOf(active);
    let nextIdx: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        nextIdx = (i + 1) % TAB_IDS.length;
        break;
      case "ArrowLeft":
        nextIdx = (i - 1 + TAB_IDS.length) % TAB_IDS.length;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = TAB_IDS.length - 1;
        break;
      default:
        return;
    }
    if (nextIdx === null) return;
    e.preventDefault();
    const id = TAB_IDS[nextIdx]!;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  const onPredictionChange = (next: MatchPrediction): void => {
    setPrediction(next);
    // Persist back into the bracket draft so the bracket page picks it
    // up next time it mounts. Same storage key BracketBuilder uses.
    try {
      const key = `vtorn:bracket:fifa-wc-2026`;
      const raw = window.localStorage.getItem(key);
      const draft = raw
        ? (JSON.parse(raw) as {
            bracketId?: string;
            matchPredictions?: Record<string, MatchPrediction>;
            knockoutPredictions?: Record<string, MatchPrediction>;
            groupTiebreakers?: Record<string, unknown>;
            version?: number;
          })
        : { matchPredictions: {}, knockoutPredictions: {}, groupTiebreakers: {}, version: 2 };
      const isKnockout = match.stage !== "group";
      const updated = {
        ...draft,
        matchPredictions: isKnockout
          ? { ...(draft.matchPredictions ?? {}) }
          : { ...(draft.matchPredictions ?? {}), [match.matchId]: next },
        knockoutPredictions: isKnockout
          ? { ...(draft.knockoutPredictions ?? {}), [match.matchId]: next }
          : { ...(draft.knockoutPredictions ?? {}) },
      };
      window.localStorage.setItem(key, JSON.stringify(updated));
    } catch {
      /* ignore */
    }
  };

  const tabsArr = useMemo(() => TAB_IDS, []);

  return (
    <section className="mp-tabs-section" aria-label="Match preview tabs">
      <div
        className="mp-tablist-wrap"
        role="tablist"
        aria-label="Match preview"
        onKeyDown={onKeyDown}
      >
        {tabsArr.map((id) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              role="tab"
              type="button"
              id={`mp-tab-${id}`}
              aria-selected={isActive}
              aria-controls={`mp-panel-${id}`}
              tabIndex={isActive ? 0 : -1}
              className={`mp-tab ${isActive ? "is-active" : ""}`}
              data-tab-id={id}
              onClick={() => setTab(id)}
            >
              {TAB_LABELS[id]}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="mp-panel-predict"
        aria-labelledby="mp-tab-predict"
        className="mp-panel"
        hidden={active !== "predict"}
      >
        <PredictTab
          match={match}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          prediction={prediction}
          onChange={onPredictionChange}
        />
      </div>

      <div
        role="tabpanel"
        id="mp-panel-h2h"
        aria-labelledby="mp-tab-h2h"
        className="mp-panel"
        hidden={active !== "h2h"}
      >
        <HeadToHeadTab
          h2h={h2h}
          homeName={homeName}
          awayName={awayName}
          homeCode={match.homeCode}
          awayCode={match.awayCode}
        />
      </div>

      <div
        role="tabpanel"
        id="mp-panel-form"
        aria-labelledby="mp-tab-form"
        className="mp-panel"
        hidden={active !== "form"}
      >
        <FormTab
          homeName={homeName}
          awayName={awayName}
          homeCode={match.homeCode}
          awayCode={match.awayCode}
          homeForm={homeForm}
          awayForm={awayForm}
        />
      </div>

      <div
        role="tabpanel"
        id="mp-panel-lineup"
        aria-labelledby="mp-tab-lineup"
        className="mp-panel"
        hidden={active !== "lineup"}
      >
        <LineupTab
          homeName={homeName}
          awayName={awayName}
          homeCode={match.homeCode}
          awayCode={match.awayCode}
          homeLineup={homeLineup}
          awayLineup={awayLineup}
        />
      </div>

      <div
        role="tabpanel"
        id="mp-panel-stats"
        aria-labelledby="mp-tab-stats"
        className="mp-panel"
        hidden={active !== "stats"}
      >
        <StatsTab
          homeName={homeName}
          awayName={awayName}
          homeCode={match.homeCode}
          awayCode={match.awayCode}
          homeStats={homeStats}
          awayStats={awayStats}
          expected={expected}
        />
      </div>
    </section>
  );
}
