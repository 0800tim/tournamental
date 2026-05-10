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

import { useEffect, useMemo, useState } from "react";

import {
  cascade,
  type Bracket,
  type CascadedBracket,
  type GroupTiebreaker,
  type MatchPrediction,
  type Tournament,
} from "@vtorn/bracket-engine";

import { GroupCard } from "./GroupCard";
import { KnockoutMatch } from "./KnockoutMatch";
import { LockSummary } from "./LockSummary";
import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import { localUserId, loadDraft, saveDraft } from "@/lib/bracket/storage";
import { submitBracket } from "@/lib/bracket/submit";
import { useCountry } from "@/lib/odds/use-country";
import type { MatchOdds } from "@/lib/odds/types";

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
  const country = useCountry();

  useEffect(() => {
    const id = localUserId();
    setUserLocalId(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) setBracket(draft);
    else setBracket({ ...emptyBracket(), bracketId: id });
  }, [tournament.id]);

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

  const onChangeMatch = (next: MatchPrediction): void => {
    update({
      ...bracket,
      matchPredictions: { ...bracket.matchPredictions, [next.matchId]: next },
    });
  };

  const onChangeTiebreaker = (next: GroupTiebreaker): void => {
    update({
      ...bracket,
      groupTiebreakers: { ...bracket.groupTiebreakers, [next.groupId]: next },
    });
  };

  const onChangeKnockout = (next: MatchPrediction): void => {
    update({
      ...bracket,
      knockoutPredictions: { ...bracket.knockoutPredictions, [next.matchId]: next },
    });
  };

  /**
   * Auto-pick — fetch live odds via /api/odds/snapshot and set every
   * match to the current favourite. Overwrites existing picks (the
   * confirmation modal warns the user before this runs); the user can
   * still adjust any pick afterwards.
   *
   * Knockout slots that don't yet have both teams resolved (because the
   * upstream group/round hasn't been picked) get skipped; auto-pick fills
   * them after the user makes those upstream picks and runs auto-pick
   * again, OR when the cascade resolves them mid-loop.
   */
  const handleAutoPick = async (): Promise<void> => {
    setShowAutoPickConfirm(false);
    setSubmitState("auto-picking from live odds…");
    let snap: { matches: Array<{ matchNo: string; homeWin: number; draw: number | null; awayWin: number }>; source?: string } | null = null;
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
    const ts = new Date().toISOString();

    // Group fixtures.
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
      next = {
        ...next,
        matchPredictions: {
          ...next.matchPredictions,
          [id]: { matchId: id, outcome, lockedAt: ts },
        },
      };
      groupAdded += 1;
    }

    // Knockouts (only those whose home + away are already resolved by the
    // current cascade; otherwise we'd be picking blind).
    for (const k of cascaded.knockouts) {
      if (!k.home.team || !k.away.team) continue;
      const o = byNo.get(k.id);
      if (!o) {
        // No live odds for this specific knockout — fall back to FIFA-rank
        // proxy: pick the lower-ranked team. This keeps auto-pick useful
        // even when Polymarket per-match KO markets are absent.
        const homeRank = tournament.teams.find((t) => t.id === k.home.team)?.fifa_rank ?? 99;
        const awayRank = tournament.teams.find((t) => t.id === k.away.team)?.fifa_rank ?? 99;
        const outcome: MatchPrediction["outcome"] =
          homeRank <= awayRank ? "home_win" : "away_win";
        next = {
          ...next,
          knockoutPredictions: {
            ...next.knockoutPredictions,
            [k.id]: { matchId: k.id, outcome, lockedAt: ts },
          },
        };
        knockoutAdded += 1;
        continue;
      }
      const outcome: MatchPrediction["outcome"] =
        o.homeWin >= o.awayWin ? "home_win" : "away_win";
      next = {
        ...next,
        knockoutPredictions: {
          ...next.knockoutPredictions,
          [k.id]: { matchId: k.id, outcome, lockedAt: ts },
        },
      };
      knockoutAdded += 1;
    }

    update(next);
    setSubmitState(
      `auto-picked ${groupAdded} group + ${knockoutAdded} knockout (source: ${snap.source ?? "mock"}). Adjust any you disagree with.`,
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
        <h1>{tournament.name} — Bracket Prophet</h1>
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
          <div className="bracket-groups-grid">
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
          <div className="km-grid">
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
