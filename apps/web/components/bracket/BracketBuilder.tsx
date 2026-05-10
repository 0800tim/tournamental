/**
 * BracketBuilder — owns prediction state for the per-match prediction
 * game. Renders the group-stage tab (12 GroupCards), the knockouts tab
 * (knockout matches in a tree), and the lock-summary tab (counts +
 * submit).
 *
 * Performance: standings are computed pure-functionally on every
 * keystroke; a 12-group recompute is sub-millisecond on every device we
 * care about. The cascade likewise re-runs on every change to feed the
 * knockout slots. No memoisation needed for v0.1.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type TabId = "groups" | "knockouts" | "lock";

function emptyBracket(): Bracket {
  return {
    bracketId: "",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 2,
  };
}

export function BracketBuilder(props: BracketBuilderProps) {
  const { tournament } = props;
  const [userLocalId, setUserLocalId] = useState<string>("ssr_user");
  const [bracket, setBracket] = useState<Bracket>(emptyBracket);
  const [tab, setTab] = useState<TabId>("groups");
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
  // Snapshot of the previous cascaded knockouts so we can detect when
  // an upstream pick changes a downstream slot — when the slot occupant
  // changes we smooth-scroll the affected card into view (only if it's
  // off-screen). Stored in a ref so the cascade effect can compare
  // without forcing extra renders.
  const prevKnockoutsRef = useRef<readonly CascadedKnockout[] | null>(null);
  const lastEditedRef = useRef<{ kind: "group" | "knockout"; matchId: string } | null>(null);

  useEffect(() => {
    const id = localUserId();
    setUserLocalId(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);
    else setBracket({ ...emptyBracket(), bracketId: id });
  }, [tournament.id]);

  // Verified-Pundit lookup runs once we know the local user id. Fails open:
  // any error/network failure leaves the badge hidden — never blocks the
  // bracket UI.
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

  // Bulk-fetch odds once on mount so every MatchPredictionRow can show
  // its W/D/L percentages inline without 72 individual requests. The
  // snapshot route has its own deterministic mock fallback when the
  // upstream odds-ingest service is unreachable.
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

  // Bridge: convert the per-match Bracket → legacy BracketPrediction so the
  // cascade engine can compute knockout slot occupancy. We then layer user
  // knockout predictions on top.
  //
  // Multi-pass: each knockout round can only resolve its home/away slots
  // once the previous round's winners are known. Iterate (group → R32 → R16
  // → QF → SF → F) so a QF pick can find its (home, away) once R16 picks
  // have populated them. Stop early at fixed point.
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
  };

  // Scroll-to-fix: when an upstream pick changes a downstream slot,
  // smooth-scroll the affected knockout card into view (only if it's
  // off-screen). We compare the previous cascade snapshot to the
  // current one and find the FIRST knockout whose home/away slot
  // changed identity. We only do this on the knockouts tab — on the
  // groups tab, downstream cards aren't visible anyway.
  useEffect(() => {
    if (tab !== "knockouts") {
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
    // requestAnimationFrame so the DOM has the new occupant rendered.
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
    // Knockout picks fire the slightly-longer cascade-resolved pattern
    // because picking a winner here ALWAYS resolves a downstream slot.
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
   *
   * Cascade-correctness: knockout slots only resolve once their
   * upstream round has a winner. We loop stage-by-stage (R32 → R16 →
   * QF → SF → TP → F), re-running the cascade after each round so the
   * next round's slots become known before we try to pick them. Picks
   * that still can't be resolved at the end get a FIFA-rank fallback
   * (even though we should never actually reach that branch with the
   * full per-stage loop in place — defensive belt + braces).
   *
   * Every pick is recorded in the prediction-history ledger with a
   * snapshot of the live odds at lock-time, so we can later score
   * "earlier picks earn higher odds" and run analytics on what users
   * believed at each step.
   */
  const handleAutoPick = async (): Promise<void> => {
    setShowAutoPickConfirm(false);
    setSubmitState("auto-picking from live odds…");
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
    // For any group that ends up with a tie that the engine can't break,
    // rank by FIFA rank (lower = better) as a sensible default. The
    // user can override via the TiebreakerControl afterwards.
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
    // Each round's slots only resolve once the previous round has
    // winners. We loop over the engine's iterative cascade to pull the
    // overlays from `next.knockoutPredictions` into the cascade output,
    // then pick whichever stage we're processing on this iteration.
    for (const stage of KO_PICK_STAGES) {
      const legacy = bracketToCascadeInput(tournament, next, userLocalId);
      let round = cascade(tournament, legacy);
      // Multi-pass: keep looping until the resolved-winner count stops
      // growing (mirrors the same pattern in the cascaded useMemo).
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
          // No per-match odds for this knockout — fall back to FIFA rank.
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
      setSubmitState(`Submitted (id: ${res.bracket_id ?? "n/a"})`);
      update(submission);
    } else if (res.status === "draft_saved_no_api") {
      setSubmitState("Draft saved locally. API not live yet — see browser console.");
    } else {
      setSubmitState(`Submit failed: ${res.error ?? "unknown"} — draft saved locally.`);
    }
  };

  const totalGroupMatches = tournament.group_fixtures.length;
  const completedGroupMatches = Object.keys(bracket.matchPredictions).length;
  const completedKnockouts = Object.keys(bracket.knockoutPredictions).length;

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
          live from your picks. Lock the bracket before kickoff for max points.
        </p>
      </header>

      <nav className="bracket-tabs" role="tablist" aria-label="Bracket sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "groups"}
          className={`bracket-tab ${tab === "groups" ? "is-active" : ""}`}
          onClick={() => setTab("groups")}
        >
          Group stage <span className="bracket-tab-count">{completedGroupMatches}/{totalGroupMatches}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "knockouts"}
          className={`bracket-tab ${tab === "knockouts" ? "is-active" : ""}`}
          onClick={() => setTab("knockouts")}
        >
          Knockouts <span className="bracket-tab-count">{completedKnockouts}/{tournament.knockouts.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "lock"}
          className={`bracket-tab ${tab === "lock" ? "is-active" : ""}`}
          onClick={() => setTab("lock")}
        >
          Lock + share
        </button>
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
        <section role="tabpanel" aria-label="Group stage" className="bracket-groups-section">
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

      {tab === "knockouts" && (
        <section role="tabpanel" aria-label="Knockouts" className="bracket-knockouts-section">
          <p className="bracket-tree-help">
            Click the team you predict will advance. Slots fill in automatically as
            you finish predicting the group stage.
          </p>
          <div className="km-pinch-wrap" ref={kmContainerRef} data-mobile-pinch="">
          <div className="km-grid" ref={kmTargetRef}>
            {(["r32", "r16", "qf", "sf", "tp", "f"] as const).map((stage) => {
              const stageMatches = cascaded.knockouts.filter((k) => k.stage === stage);
              if (stageMatches.length === 0) return null;
              const stageLabel: Record<typeof stage, string> = {
                r32: "R32",
                r16: "R16",
                qf: "QF",
                sf: "SF",
                tp: "3RD PLACE",
                f: "FINAL",
              };
              return (
                <div key={stage} className="km-stage-col">
                  <h3>{stageLabel[stage]}</h3>
                  {stageMatches.map((k) => (
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
            })}
          </div>
          </div>
        </section>
      )}

      {tab === "lock" && (
        <section role="tabpanel" aria-label="Lock + share" className="bracket-lock-section">
          <LockSummary
            bracket={bracket}
            cascaded={cascaded}
            tournament={tournament}
            deadline_utc={tournament.start_utc}
          />
          <div className="bracket-lock-counts">
            <div>
              <strong>{completedGroupMatches}</strong> / {totalGroupMatches} group matches
            </div>
            <div>
              <strong>{completedKnockouts}</strong> / {tournament.knockouts.length} knockout picks
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
              Save draft
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="bracket-btn bracket-btn-primary"
            >
              Lock final
            </button>
            {submitState && <span className="bracket-submit-state">{submitState}</span>}
          </div>
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
              point, not a lock.
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
