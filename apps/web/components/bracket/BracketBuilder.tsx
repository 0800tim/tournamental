/**
 * BracketBuilder — the single client component that owns prediction
 * state, runs the cascade calculator on every change, and renders the
 * group cards + tree + lock indicator + save/submit controls.
 *
 * Performance: cascade is pure and runs on every state change. With 8
 * groups + 32 knockouts that's ~150 slot resolutions per re-render —
 * sub-millisecond on every device we care about. No memoisation
 * required for v0.1; we'll add `useMemo` if profiling ever shows it.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  BracketPrediction,
  CascadedBracket,
  Tournament,
  cascade,
} from "@vtorn/bracket-engine";

import { GroupCard } from "./GroupCard";
import { BracketTree } from "./BracketTree";
import { LockSummary } from "./LockSummary";
import { localUserId, loadDraft, saveDraft } from "@/lib/bracket/storage";
import { submitBracket } from "@/lib/bracket/submit";

export interface BracketBuilderProps {
  readonly tournament: Tournament;
}

function emptyPrediction(tournament_id: string, user_id: string): BracketPrediction {
  return {
    tournament_id,
    user_id,
    groups: [],
    best_thirds: [],
    best_fourths: [],
    knockouts: [],
    locks: [],
    updated_at_utc: new Date().toISOString(),
  };
}

export function BracketBuilder(props: BracketBuilderProps) {
  const { tournament } = props;
  const [userLocalId, setUserLocalId] = useState<string>("ssr_user");
  const [prediction, setPrediction] = useState<BracketPrediction>(() =>
    emptyPrediction(tournament.id, "ssr_user"),
  );
  const [submitState, setSubmitState] = useState<string>("");

  // hydrate from localStorage after mount
  useEffect(() => {
    const id = localUserId();
    setUserLocalId(id);
    const draft = loadDraft(tournament.id, id);
    if (draft) {
      setPrediction(draft);
    } else {
      // seed empty groups so reorder controls work immediately
      setPrediction({
        ...emptyPrediction(tournament.id, id),
        groups: tournament.groups.map((g) => ({
          group_id: g.id,
          order: [...g.team_ids],
        })),
      });
    }
  }, [tournament.id, tournament.groups]);

  const teamMap = useMemo(() => new Map(tournament.teams.map((t) => [t.id, t])), [tournament.teams]);

  const cascaded: CascadedBracket = useMemo(
    () => cascade(tournament, prediction),
    [tournament, prediction],
  );

  const updatePrediction = (next: BracketPrediction): void => {
    const stamped = { ...next, updated_at_utc: new Date().toISOString(), user_id: userLocalId };
    setPrediction(stamped);
    saveDraft(stamped, userLocalId);
  };

  const onReorder = (group_id: string, order: readonly string[]): void => {
    const groups = prediction.groups.some((g) => g.group_id === group_id)
      ? prediction.groups.map((g) => (g.group_id === group_id ? { group_id, order } : g))
      : [...prediction.groups, { group_id, order }];
    updatePrediction({ ...prediction, groups });
  };

  const onPickWinner = (match_id: string, team_id: string): void => {
    const knockouts = prediction.knockouts.some((k) => k.match_id === match_id)
      ? prediction.knockouts.map((k) =>
          k.match_id === match_id ? { match_id, winner: team_id } : k,
        )
      : [...prediction.knockouts, { match_id, winner: team_id }];
    updatePrediction({ ...prediction, knockouts });
  };

  const toggleLock = (key: string, market_implied: number): void => {
    const exists = prediction.locks.some((l) => l.key === key);
    const locks = exists
      ? prediction.locks.filter((l) => l.key !== key)
      : [
          ...prediction.locks,
          {
            key,
            locked_at_utc: new Date().toISOString(),
            market_implied_at_lock: market_implied,
          },
        ];
    updatePrediction({ ...prediction, locks });
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitState("submitting…");
    const res = await submitBracket(prediction, userLocalId);
    if (res.ok) {
      setSubmitState(`Submitted (id: ${res.bracket_id ?? "n/a"})`);
    } else if (res.status === "draft_saved_no_api") {
      setSubmitState("Draft saved locally. API not live yet — see browser console.");
    } else {
      setSubmitState(`Submit failed: ${res.error ?? "unknown"} — draft saved locally.`);
    }
  };

  return (
    <div className="bracket-builder">
      <header className="bracket-header">
        <h1>{tournament.name}</h1>
        <p>
          Predict every match. Picks update the downstream tree instantly. Lock
          individual picks at the current odds for higher points if correct.
        </p>
      </header>

      <LockSummary
        cascaded={cascaded}
        tournament={tournament}
        deadline_utc={tournament.start_utc}
      />

      <section aria-label="Group stage" className="bracket-groups-section">
        <h2>Group stage</h2>
        <div className="bracket-groups-grid">
          {tournament.groups.map((g) => {
            const groupPrediction = prediction.groups.find((p) => p.group_id === g.id);
            const order = groupPrediction?.order ?? g.team_ids;
            const locked = prediction.locks.some((l) => l.key === `group:${g.id}`);
            return (
              <GroupCard
                key={g.id}
                group={g}
                teams={teamMap}
                order={order}
                locked={locked}
                onReorder={onReorder}
                onToggleLock={(gid) => {
                  const team = teamMap.get(order[0] ?? "");
                  toggleLock(`group:${gid}`, team?.pre_tournament_implied_win ?? 0.5);
                }}
              />
            );
          })}
        </div>
      </section>

      <section aria-label="Knockout tree" className="bracket-tree-section">
        <h2>Knockout tree</h2>
        <p className="bracket-tree-help">
          Click a team to set them as the predicted winner; the next round
          updates immediately. Click the dot in the corner of each card to
          lock that pick at the current odds.
        </p>
        <BracketTree
          tournament={tournament}
          knockouts={cascaded.knockouts}
          teams={teamMap}
          onPickWinner={onPickWinner}
          onToggleLock={(match_id) => {
            const k = cascaded.knockouts.find((m) => m.id === match_id);
            const winnerTeam = k?.predicted_winner ? teamMap.get(k.predicted_winner) : null;
            toggleLock(`knockout:${match_id}`, winnerTeam?.pre_tournament_implied_win ?? 0.5);
          }}
          lockedKeys={cascaded.locked_keys}
        />
      </section>

      <section className="bracket-actions">
        <button type="button" onClick={() => saveDraft(prediction, userLocalId)} className="bracket-btn bracket-btn-secondary">
          Save draft
        </button>
        <button type="button" onClick={handleSubmit} className="bracket-btn bracket-btn-primary">
          Submit final
        </button>
        {submitState && <span className="bracket-submit-state">{submitState}</span>}
      </section>

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
    </div>
  );
}
