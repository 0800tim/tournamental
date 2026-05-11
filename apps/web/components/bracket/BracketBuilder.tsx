/**
 * BracketBuilder — owns prediction state for the per-match prediction
 * game.
 *
 * The bracket is split into round-tabs so users (especially on mobile)
 * can navigate the 104-match tournament one round at a time:
 *
 *   - Groups   — 12 GroupCards, vertical stack per group
 *   - R32      — Round-of-32 cards in a responsive grid
 *   - R16      — Round-of-16 cards in a responsive grid
 *   - QF       — Quarter-finals
 *   - SF + 3rd — Semi-finals + 3rd-place playoff
 *   - Final    — the Final match + save & share summary
 *
 * Tab state is URL-hash-routable so the user can bookmark or share
 * `/world-cup-2026#qf` and land on the quarter-finals.
 *
 * "Save" everywhere in user copy: the internal field name `lockedAt`
 * (used by the scoring engine) is intentionally preserved, but every
 * user-facing button/label/toast reads as "Save" / "Saved". Tim's spec:
 * picks are changeable until the match kicks off, so "lock" sounds too
 * final.
 *
 * Performance: standings are computed pure-functionally on every
 * keystroke; a 12-group recompute is sub-millisecond on every device we
 * care about. The cascade likewise re-runs on every change to feed the
 * knockout slots. No memoisation needed for v0.1.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cascade,
  type Bracket,
  type CascadedBracket,
  type CascadedKnockout,
  type GroupTiebreaker,
  type MatchPrediction,
  type Tournament,
} from "@vtorn/bracket-engine";

import { GroupCard } from "./GroupCard";
import { KnockoutMatch } from "./KnockoutMatch";
import { LockSummary } from "./LockSummary";
import { PunditBadge } from "@/components/shared/PunditBadge";
import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { appendHistory, snapshotOdds } from "@/lib/bracket/history";
import {
  HAPTIC,
  scrollIntoViewIfHidden,
  useHaptic,
  usePinchZoom,
  useStickyGroupHeaders,
} from "@/lib/bracket/mobile-gestures";
import { track } from "@/lib/analytics";
import { localUserId, loadDraft, saveDraft } from "@/lib/bracket/storage";
import { submitBracket } from "@/lib/bracket/submit";
import { useCountry } from "@/lib/odds/use-country";
import type { MatchOdds } from "@/lib/odds/types";
import { fetchPunditStatus, type PunditStatus, UNVERIFIED } from "@/lib/pundit";

import type { StageId } from "@vtorn/bracket-engine";

const KO_PICK_STAGES: readonly StageId[] = ["r32", "r16", "qf", "sf", "tp", "f"] as const;

export interface BracketBuilderProps {
  readonly tournament: Tournament;
}

/**
 * One tab per round, plus the final-round tab also hosts the
 * "save & share" summary. `groups` is the default landing tab.
 */
type TabId = "groups" | "r32" | "r16" | "qf" | "sf" | "final";

const TAB_ORDER: readonly TabId[] = ["groups", "r32", "r16", "qf", "sf", "final"];

interface TabMeta {
  readonly id: TabId;
  readonly label: string;
  readonly hash: string;
  readonly aria: string;
}

const TABS: readonly TabMeta[] = [
  { id: "groups", label: "Groups", hash: "#groups", aria: "Group stage matches" },
  { id: "r32", label: "R32", hash: "#r32", aria: "Round of 32" },
  { id: "r16", label: "R16", hash: "#r16", aria: "Round of 16" },
  { id: "qf", label: "QF", hash: "#qf", aria: "Quarter-finals" },
  { id: "sf", label: "SF + 3rd", hash: "#sf", aria: "Semi-finals and 3rd-place play-off" },
  { id: "final", label: "Final", hash: "#final", aria: "Final and bracket summary" },
];

function hashToTab(raw: string | undefined | null): TabId {
  if (!raw) return "groups";
  const cleaned = raw.replace(/^#/, "").toLowerCase();
  // Allow a few obvious aliases so old `#knockouts` / `#lock` deeplinks
  // don't drop the user on a 404-feeling blank tab.
  if (cleaned === "knockouts") return "r32";
  if (cleaned === "lock") return "final";
  const found = TABS.find((t) => t.id === cleaned);
  return found ? found.id : "groups";
}

function emptyBracket(): Bracket {
  return {
    bracketId: "",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 2,
  };
}

/**
 * Count picks for a given knockout stage so the per-tab progress
 * indicator reads "x of N picked".
 */
function knockoutCountFor(
  stage: TabId,
  cascaded: CascadedBracket,
  picks: Record<string, MatchPrediction>,
): { picked: number; total: number } {
  const stageIds =
    stage === "sf"
      ? (["sf", "tp"] as const)
      : stage === "final"
        ? (["f"] as const)
        : ([stage] as const);
  const matches = cascaded.knockouts.filter((k) =>
    (stageIds as readonly string[]).includes(k.stage),
  );
  const total = matches.length;
  let picked = 0;
  for (const m of matches) if (picks[m.id]) picked += 1;
  return { picked, total };
}

export function BracketBuilder(props: BracketBuilderProps) {
  const { tournament } = props;
  const [userLocalId, setUserLocalId] = useState<string>("ssr_user");
  const [bracket, setBracket] = useState<Bracket>(emptyBracket);
  const [tab, setTabState] = useState<TabId>("groups");
  const [submitState, setSubmitState] = useState<string>("");
  const [showAutoPickConfirm, setShowAutoPickConfirm] = useState<boolean>(false);
  const [oddsByMatch, setOddsByMatch] = useState<ReadonlyMap<string, MatchOdds>>(
    () => new Map(),
  );
  const [punditStatus, setPunditStatus] = useState<PunditStatus>(UNVERIFIED);
  const country = useCountry();

  // Mobile gesture plumbing — these refs/effects are no-ops on
  // viewports wider than 640px so desktop UX is untouched.
  const haptic = useHaptic();
  const groupsRootRef = useStickyGroupHeaders<HTMLDivElement>({
    headerSelector: ".bracket-group-head",
  });
  const { containerRef: kmContainerRef, targetRef: kmTargetRef } = usePinchZoom<
    HTMLDivElement,
    HTMLDivElement
  >();
  const prevKnockoutsRef = useRef<readonly CascadedKnockout[] | null>(null);
  const lastEditedRef = useRef<{ kind: "group" | "knockout"; matchId: string } | null>(null);

  // Hash-driven tab routing. On mount, read window.location.hash. We
  // listen for hashchange so back/forward navigation keeps the tab in
  // sync. Writing the hash is debounced through `setTab` below.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => setTabState(hashToTab(window.location.hash));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const setTab = useCallback((next: TabId) => {
    setTabState(next);
    if (typeof window === "undefined") return;
    const target = TABS.find((t) => t.id === next)?.hash ?? "#groups";
    // Use history.replaceState so we don't pollute the back stack on
    // every tab nudge; we still fire a synthetic hashchange so any
    // sibling components listening pick it up.
    if (window.location.hash !== target) {
      const url = `${window.location.pathname}${window.location.search}${target}`;
      window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => {
    const id = localUserId();
    setUserLocalId(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);
    else setBracket({ ...emptyBracket(), bracketId: id });
  }, [tournament.id]);

  useEffect(() => {
    if (userLocalId === "ssr_user") return;
    let cancelled = false;
    fetchPunditStatus(userLocalId).then((status) => {
      if (!cancelled) setPunditStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [userLocalId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/odds/snapshot", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !Array.isArray(j.matches)) return;
        const m = new Map<string, MatchOdds>();
        for (const o of j.matches as MatchOdds[]) m.set(String(o.matchNo), o);
        setOddsByMatch(m);
      })
      .catch(() => {
        /* leave empty; rows render dashes until/unless odds load */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teamMap = useMemo(
    () => new Map(tournament.teams.map((t) => [t.id, t])),
    [tournament.teams],
  );

  const cascaded: CascadedBracket = useMemo(() => {
    const legacy = bracketToCascadeInput(tournament, bracket, userLocalId);
    let result = cascade(tournament, legacy);
    for (let pass = 0; pass < 6; pass += 1) {
      const knockouts = Object.values(bracket.knockoutPredictions)
        .map((p) => {
          const k = result.knockouts.find((x) => x.id === p.matchId);
          if (!k) return null;
          const team = p.outcome === "home_win" ? k.home.team : k.away.team;
          return team ? { match_id: p.matchId, winner: team } : null;
        })
        .filter((x): x is { match_id: string; winner: string } => x !== null);
      const before = result.knockouts.filter((k) => k.effective_winner).length;
      result = cascade(tournament, { ...legacy, knockouts });
      const after = result.knockouts.filter((k) => k.effective_winner).length;
      if (after === before) break;
    }
    return result;
  }, [tournament, bracket, userLocalId]);

  const update = (next: Bracket): void => {
    setBracket(next);
    saveDraft(tournament.id, next, userLocalId);
    // Analytics: a pick was just saved to the draft. Fire-and-forget;
    // payload carries totals (not the picks themselves) so GA4 cohorts
    // can segment by bracket-completion without exposing predictions.
    track("bracket.pick.saved", {
      tournament_id: tournament.id,
      match_predictions: Object.keys(next.matchPredictions).length,
      knockout_predictions: Object.keys(next.knockoutPredictions).length,
      tiebreakers: Object.keys(next.groupTiebreakers).length,
    });
  };

  // Scroll-to-fix: when an upstream pick changes a downstream slot,
  // smooth-scroll the affected knockout card into view if off-screen.
  // We only do this on the per-round tabs that show knockouts.
  useEffect(() => {
    if (tab === "groups") {
      prevKnockoutsRef.current = cascaded.knockouts;
      return;
    }
    const prev = prevKnockoutsRef.current;
    prevKnockoutsRef.current = cascaded.knockouts;
    if (!prev) return;
    const lastEdited = lastEditedRef.current;
    if (!lastEdited) return;
    const prevById = new Map(prev.map((k) => [k.id, k] as const));
    const changed = cascaded.knockouts.find((k) => {
      if (k.id === lastEdited.matchId) return false;
      const before = prevById.get(k.id);
      if (!before) return false;
      return (
        before.home.team !== k.home.team || before.away.team !== k.away.team
      );
    });
    if (!changed) return;
    const raf =
      typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16);
    const cancel =
      typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function"
        ? window.cancelAnimationFrame
        : (id: number) => clearTimeout(id);
    const handle = raf(() => {
      const el = document.querySelector(`[data-match-id="${changed.id}"]`);
      scrollIntoViewIfHidden(el);
    });
    return () => cancel(handle as number);
  }, [cascaded.knockouts, tab]);

  const onChangeMatch = (next: MatchPrediction): void => {
    const prev = bracket.matchPredictions[next.matchId];
    const isOutcomeChange = !prev || prev.outcome !== next.outcome;
    if (isOutcomeChange) haptic(HAPTIC.pick);
    lastEditedRef.current = { kind: "group", matchId: next.matchId };
    appendHistory(tournament.id, userLocalId, {
      type:
        prev && (prev.homeScore !== next.homeScore || prev.awayScore !== next.awayScore)
          ? "match_score"
          : "match_pick",
      id: next.matchId,
      outcome: next.outcome,
      prevOutcome: prev?.outcome,
      odds: next.oddsAtLock ?? prev?.oddsAtLock,
      ts: next.lockedAt,
    });
    update({
      ...bracket,
      matchPredictions: { ...bracket.matchPredictions, [next.matchId]: next },
    });
  };

  const onChangeTiebreaker = (next: GroupTiebreaker): void => {
    appendHistory(tournament.id, userLocalId, {
      type: "tiebreaker_set",
      id: next.groupId,
      ts: next.setAt,
    });
    update({
      ...bracket,
      groupTiebreakers: { ...bracket.groupTiebreakers, [next.groupId]: next },
    });
  };

  const onChangeKnockout = (next: MatchPrediction): void => {
    const prev = bracket.knockoutPredictions[next.matchId];
    const isOutcomeChange = !prev || prev.outcome !== next.outcome;
    if (isOutcomeChange) haptic(HAPTIC.cascadeResolved);
    lastEditedRef.current = { kind: "knockout", matchId: next.matchId };
    appendHistory(tournament.id, userLocalId, {
      type: "knockout_pick",
      id: next.matchId,
      outcome: next.outcome,
      prevOutcome: prev?.outcome,
      odds: next.oddsAtLock ?? prev?.oddsAtLock,
      ts: next.lockedAt,
    });
    update({
      ...bracket,
      knockoutPredictions: { ...bracket.knockoutPredictions, [next.matchId]: next },
    });
  };

  /**
   * Auto-pick — fetch live odds via /api/odds/snapshot and fill EVERY
   * match all the way down to the final, including the 3rd-place
   * playoff and any group tiebreakers. Overwrites existing picks (the
   * confirmation modal warns first); user can adjust any pick after.
   */
  const handleAutoPick = async (): Promise<void> => {
    setShowAutoPickConfirm(false);
    setSubmitState("auto-picking from live odds…");
    track("bracket.autopick.run", { tournament_id: tournament.id });
    let snap: { matches: MatchOdds[]; source?: string } | null = null;
    try {
      const r = await fetch("/api/odds/snapshot", { headers: { Accept: "application/json" } });
      if (r.ok) snap = await r.json();
    } catch {
      /* fall through to mock; /api/odds/snapshot has its own deterministic mock fallback */
    }
    if (!snap || !Array.isArray(snap.matches)) {
      setSubmitState("auto-pick: couldn't load odds; nothing changed.");
      return;
    }
    const byNo = new Map(snap.matches.map((m) => [String(m.matchNo), m]));

    let next: Bracket = bracket;
    let groupAdded = 0;
    let knockoutAdded = 0;
    let tiebreakersSet = 0;
    const ts = new Date().toISOString();

    // ---------- Group fixtures ----------
    for (const f of tournament.group_fixtures) {
      const id = String(f.match_no);
      const o = byNo.get(id);
      if (!o) continue;
      const h = o.homeWin;
      const d = o.draw ?? -1;
      const a = o.awayWin;
      const max = Math.max(h, d, a);
      const outcome: MatchPrediction["outcome"] =
        max === h ? "home_win" : max === d ? "draw" : "away_win";
      const prev = next.matchPredictions[id]?.outcome;
      const oddsAtLock = snapshotOdds(o);
      next = {
        ...next,
        matchPredictions: {
          ...next.matchPredictions,
          [id]: { matchId: id, outcome, lockedAt: ts, oddsAtLock },
        },
      };
      appendHistory(tournament.id, userLocalId, {
        type: "match_pick",
        id,
        outcome,
        prevOutcome: prev,
        odds: oddsAtLock,
        ts,
      });
      groupAdded += 1;
    }

    // ---------- Group tiebreakers ----------
    for (const g of tournament.groups) {
      const teamIds = g.team_ids;
      if (teamIds.length !== 4) continue;
      const ranked = [...teamIds].sort((aId, bId) => {
        const ar = tournament.teams.find((t) => t.id === aId)?.fifa_rank ?? 99;
        const br = tournament.teams.find((t) => t.id === bId)?.fifa_rank ?? 99;
        return ar - br;
      }) as [string, string, string, string];
      next = {
        ...next,
        groupTiebreakers: {
          ...next.groupTiebreakers,
          [g.id]: { groupId: g.id, rankedTeams: ranked, setAt: ts },
        },
      };
      tiebreakersSet += 1;
      appendHistory(tournament.id, userLocalId, {
        type: "tiebreaker_set",
        id: g.id,
        ts,
      });
    }

    // ---------- Knockouts: stage-by-stage with re-cascade ----------
    for (const stage of KO_PICK_STAGES) {
      const legacy = bracketToCascadeInput(tournament, next, userLocalId);
      let round = cascade(tournament, legacy);
      for (let pass = 0; pass < 6; pass += 1) {
        const overlays = Object.values(next.knockoutPredictions)
          .map((p) => {
            const k = round.knockouts.find((x) => x.id === p.matchId);
            if (!k) return null;
            const team = p.outcome === "home_win" ? k.home.team : k.away.team;
            return team ? { match_id: p.matchId, winner: team } : null;
          })
          .filter((x): x is { match_id: string; winner: string } => x !== null);
        const before = round.knockouts.filter((k) => k.effective_winner).length;
        round = cascade(tournament, { ...legacy, knockouts: overlays });
        const after = round.knockouts.filter((k) => k.effective_winner).length;
        if (after === before) break;
      }
      const stageMatches = round.knockouts.filter((k) => k.stage === stage);
      for (const k of stageMatches) {
        if (!k.home.team || !k.away.team) continue;
        const o = byNo.get(k.id);
        const prev = next.knockoutPredictions[k.id]?.outcome;
        let outcome: MatchPrediction["outcome"];
        let oddsAtLock = snapshotOdds(o);
        if (o) {
          outcome = o.homeWin >= o.awayWin ? "home_win" : "away_win";
        } else {
          const homeRank = tournament.teams.find((t) => t.id === k.home.team)?.fifa_rank ?? 99;
          const awayRank = tournament.teams.find((t) => t.id === k.away.team)?.fifa_rank ?? 99;
          outcome = homeRank <= awayRank ? "home_win" : "away_win";
          oddsAtLock = undefined;
        }
        next = {
          ...next,
          knockoutPredictions: {
            ...next.knockoutPredictions,
            [k.id]: { matchId: k.id, outcome, lockedAt: ts, oddsAtLock },
          },
        };
        appendHistory(tournament.id, userLocalId, {
          type: "knockout_pick",
          id: k.id,
          outcome,
          prevOutcome: prev,
          odds: oddsAtLock,
          ts,
        });
        knockoutAdded += 1;
      }
    }

    appendHistory(tournament.id, userLocalId, {
      type: "auto_pick_run",
      id: "",
      ts,
      picksAdded: groupAdded + knockoutAdded,
    });

    update(next);
    setSubmitState(
      `auto-picked ${groupAdded} group + ${knockoutAdded} knockout + ${tiebreakersSet} tiebreakers (source: ${snap.source ?? "mock"}). Adjust any you disagree with.`,
    );
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitState("submitting…");
    const submission: Bracket = {
      ...bracket,
      lockedAt: new Date().toISOString(),
    };
    const res = await submitBracket(tournament.id, submission, userLocalId);
    if (res.ok) {
      setSubmitState(`Saved (id: ${res.bracket_id ?? "n/a"})`);
      update(submission);
      track("bracket.bracket.saved", {
        tournament_id: tournament.id,
        bracket_id: res.bracket_id ?? null,
        match_predictions: Object.keys(submission.matchPredictions).length,
        knockout_predictions: Object.keys(submission.knockoutPredictions).length,
        result: "ok",
      });
    } else if (res.status === "draft_saved_no_api") {
      setSubmitState("Draft saved locally. API not live yet — see browser console.");
      track("bracket.bracket.saved", {
        tournament_id: tournament.id,
        result: "draft_only",
      });
    } else {
      setSubmitState(`Save failed: ${res.error ?? "unknown"} — draft saved locally.`);
      track("bracket.bracket.saved", {
        tournament_id: tournament.id,
        result: "error",
        error: res.error ?? "unknown",
      });
    }
  };

  const handleMobileSave = (): void => {
    saveDraft(tournament.id, bracket, userLocalId);
    setSubmitState("Saved locally.");
  };

  const totalGroupMatches = tournament.group_fixtures.length;
  const completedGroupMatches = Object.keys(bracket.matchPredictions).length;
  const completedKnockouts = Object.keys(bracket.knockoutPredictions).length;
  const totalKnockouts = tournament.knockouts.length;
  const totalPicks = totalGroupMatches + totalKnockouts;
  const totalCompleted = completedGroupMatches + completedKnockouts;

  // Per-tab progress counter labels.
  const groupProgress = { picked: completedGroupMatches, total: totalGroupMatches };
  const r32Progress = knockoutCountFor("r32", cascaded, bracket.knockoutPredictions);
  const r16Progress = knockoutCountFor("r16", cascaded, bracket.knockoutPredictions);
  const qfProgress = knockoutCountFor("qf", cascaded, bracket.knockoutPredictions);
  const sfProgress = knockoutCountFor("sf", cascaded, bracket.knockoutPredictions);
  const finalProgress = knockoutCountFor("final", cascaded, bracket.knockoutPredictions);

  const progressByTab: Record<TabId, { picked: number; total: number }> = {
    groups: groupProgress,
    r32: r32Progress,
    r16: r16Progress,
    qf: qfProgress,
    sf: sfProgress,
    final: finalProgress,
  };

  const stagesForTab = (id: TabId): readonly StageId[] => {
    if (id === "sf") return ["sf", "tp"];
    if (id === "final") return ["f"];
    if (id === "groups") return [];
    return [id as StageId];
  };

  const renderKnockoutGrid = (id: TabId) => {
    const stages = stagesForTab(id);
    const matches = cascaded.knockouts.filter((k) =>
      (stages as readonly string[]).includes(k.stage),
    );
    if (matches.length === 0) {
      return (
        <p className="bracket-empty-state">
          Make your group-stage picks first — slots fill in here as you pick.
        </p>
      );
    }
    // SF tab: split into Semi-finals + 3rd-place playoff sub-groups so
    // the 3rd-place match doesn't read as just another SF card.
    if (id === "sf") {
      const sf = matches.filter((k) => k.stage === "sf");
      const tp = matches.filter((k) => k.stage === "tp");
      return (
        <>
          {sf.length > 0 && (
            <section
              className="bracket-round-subgroup"
              aria-label="Semi-finals"
            >
              <h3 className="bracket-round-subgroup-title">Semi-finals</h3>
              <div className="bracket-round-grid">
                {sf.map((k) => (
                  <KnockoutMatch
                    key={k.id}
                    knockout={k}
                    teams={teamMap}
                    prediction={bracket.knockoutPredictions[k.id]}
                    country={country}
                    onChange={onChangeKnockout}
                  />
                ))}
              </div>
            </section>
          )}
          {tp.length > 0 && (
            <section
              className="bracket-round-subgroup"
              aria-label="3rd-place play-off"
            >
              <h3 className="bracket-round-subgroup-title">3rd-place play-off</h3>
              <div className="bracket-round-grid">
                {tp.map((k) => (
                  <KnockoutMatch
                    key={k.id}
                    knockout={k}
                    teams={teamMap}
                    prediction={bracket.knockoutPredictions[k.id]}
                    country={country}
                    onChange={onChangeKnockout}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      );
    }
    return (
      <div
        className={`bracket-round-grid ${id === "final" ? "bracket-round-grid-final" : ""}`}
      >
        {matches.map((k) => (
          <KnockoutMatch
            key={k.id}
            knockout={k}
            teams={teamMap}
            prediction={bracket.knockoutPredictions[k.id]}
            country={country}
            onChange={onChangeKnockout}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="bracket-builder">
      <header className="bracket-header">
        <h1>
          {tournament.name} — Bracket Prophet
          {punditStatus.verified && (
            <span style={{ marginLeft: 10, display: "inline-flex", verticalAlign: "middle" }}>
              <PunditBadge status={punditStatus} size={20} />
            </span>
          )}
        </h1>
        <p>
          Predict the outcome of every match. The group standings are computed
          live from your picks. Save each pick before its match kicks off — you
          can tweak any pick game by game until then.
        </p>
        <p className="bracket-header-running-total" aria-live="polite">
          <strong>{totalCompleted}</strong> of {totalPicks} matches picked
        </p>
      </header>

      <nav className="bracket-tabs" role="tablist" aria-label="Bracket rounds">
        {TABS.map((t) => {
          const p = progressByTab[t.id];
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`bracket-panel-${t.id}`}
              className={`bracket-tab ${isActive ? "is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="bracket-tab-label">{t.label}</span>
              {p.total > 0 && (
                <span className="bracket-tab-count" aria-label={`${p.picked} of ${p.total} picked`}>
                  {p.picked}/{p.total}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className="bracket-tab bracket-tab-autopick"
          onClick={() => setShowAutoPickConfirm(true)}
          aria-label="Auto-pick from live odds"
          title="Auto-pick every match to the current Polymarket favourite"
        >
          ⚡ Auto-pick
        </button>
      </nav>

      {tab === "groups" && (
        <section
          id="bracket-panel-groups"
          role="tabpanel"
          aria-label="Group stage"
          className="bracket-panel bracket-groups-section"
        >
          <div className="bracket-round-header">
            <h2>Group stage</h2>
            <span className="bracket-round-progress">
              <strong>{groupProgress.picked}</strong> of {groupProgress.total} matches picked
            </span>
          </div>
          <div className="bracket-groups-grid" ref={groupsRootRef}>
            {tournament.groups.map((g) => (
              <GroupCard
                key={g.id}
                tournament={tournament}
                group={g}
                teams={teamMap}
                matchPredictions={bracket.matchPredictions}
                tiebreaker={bracket.groupTiebreakers[g.id]}
                country={country}
                oddsByMatch={oddsByMatch}
                onChangeMatch={onChangeMatch}
                onChangeTiebreaker={onChangeTiebreaker}
              />
            ))}
          </div>
        </section>
      )}

      {tab !== "groups" && tab !== "final" && (
        <section
          id={`bracket-panel-${tab}`}
          role="tabpanel"
          aria-label={TABS.find((t) => t.id === tab)?.aria ?? "Knockouts"}
          className={`bracket-panel bracket-round-section bracket-round-${tab}`}
        >
          <div className="bracket-round-header">
            <h2>{TABS.find((t) => t.id === tab)?.aria ?? "Knockouts"}</h2>
            <span className="bracket-round-progress">
              <strong>{progressByTab[tab].picked}</strong> of {progressByTab[tab].total} picked
            </span>
          </div>
          <p className="bracket-round-help">
            Tap the team you predict will advance. Slots fill in as you finish
            the previous round.
          </p>
          <div className="km-pinch-wrap" ref={kmContainerRef} data-mobile-pinch="">
            <div className="km-grid km-grid-single-round" ref={kmTargetRef}>
              {renderKnockoutGrid(tab)}
            </div>
          </div>
        </section>
      )}

      {tab === "final" && (
        <section
          id="bracket-panel-final"
          role="tabpanel"
          aria-label="Final and bracket summary"
          className="bracket-panel bracket-final-section"
        >
          <div className="bracket-round-header">
            <h2>Final</h2>
            <span className="bracket-round-progress">
              <strong>{finalProgress.picked}</strong> of {finalProgress.total} picked
            </span>
          </div>
          <div className="bracket-final-layout">
            <div className="bracket-final-match km-pinch-wrap" ref={kmContainerRef} data-mobile-pinch="">
              <div className="km-grid km-grid-final" ref={kmTargetRef}>
                {renderKnockoutGrid("final")}
              </div>
            </div>
            <LockSummary
              bracket={bracket}
              cascaded={cascaded}
              tournament={tournament}
              deadline_utc={tournament.start_utc}
            />
          </div>
          <div className="bracket-lock-counts">
            <div>
              <strong>{completedGroupMatches}</strong> / {totalGroupMatches} group matches
            </div>
            <div>
              <strong>{completedKnockouts}</strong> / {totalKnockouts} knockout picks
            </div>
            <div>
              <strong>{Object.keys(bracket.groupTiebreakers).length}</strong> tiebreakers set
            </div>
          </div>
          <div className="bracket-actions">
            <button
              type="button"
              onClick={() => saveDraft(tournament.id, bracket, userLocalId)}
              className="bracket-btn bracket-btn-secondary"
            >
              Save draft locally
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="bracket-btn bracket-btn-primary"
            >
              Save bracket
            </button>
            {submitState && <span className="bracket-submit-state">{submitState}</span>}
          </div>
          <p className="bracket-final-note">
            You can change any pick right up until that match kicks off. Saving
            now lets you share your bracket and locks in your odds-at-pick for
            scoring.
          </p>
        </section>
      )}

      {cascaded.warnings.length > 0 && (
        <details className="bracket-warnings">
          <summary>{cascaded.warnings.length} cascade warnings</summary>
          <ul>
            {cascaded.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>
                <code>{w.code}</code> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Mobile-only floating Save & Share CTA. Save persists any
       * unsaved edits; Share is wired up by the share-card agent —
       * stub here so the layout/CSS lands now. */}
      <div className="bracket-mobile-cta" role="group" aria-label="Save and share">
        <button
          type="button"
          className="bracket-mobile-cta-btn bracket-mobile-cta-save"
          onClick={handleMobileSave}
        >
          Save
        </button>
        <button
          type="button"
          className="bracket-mobile-cta-btn bracket-mobile-cta-share"
          // TODO(share-card-agent): wire to the share modal once it lands.
          onClick={() => {
            track("bracket.share.opened", {
              tournament_id: tournament.id,
              surface: "mobile_cta",
            });
            setTab("final");
          }}
          aria-label="Share — opens the bracket summary"
        >
          Share
        </button>
      </div>

      {showAutoPickConfirm && (
        <div
          className="bracket-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="autopick-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAutoPickConfirm(false);
          }}
        >
          <div className="bracket-modal">
            <h2 id="autopick-confirm-title" className="bracket-modal-title">
              ⚡ Auto-pick the favourite for every match?
            </h2>
            <p className="bracket-modal-body">
              Auto-pick uses live Polymarket odds to set every match to the
              current favourite. <strong>Your existing picks will be
              overwritten.</strong>
            </p>
            <p className="bracket-modal-body">
              You can change any pick afterwards — auto-pick is a starting
              point, not a final answer. Picks save as you tweak them.
            </p>
            <div className="bracket-modal-actions">
              <button
                type="button"
                className="bracket-btn bracket-btn-secondary"
                onClick={() => setShowAutoPickConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bracket-btn bracket-btn-primary"
                onClick={handleAutoPick}
                autoFocus
              >
                Yes, auto-pick favourites
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
