/**
 * "Top 8 3rd Place" stage. Lives between Groups and R32 in the bracket
 * tabs. The 2026 World Cup advances the top 2 of each group + the 8 best
 * 3rd-placed teams. The 8 are determined by FIFA's tiebreaker rules
 * (points → goal diff → goals scored → discipline → drawing of lots),
 * which can't be computed from our outcome-only predictions (no score
 * lines). So we ask the user to consciously select 8 of the 12 third
 * placers, persist into `bracket.bestThirds`, then let the FIFA
 * Annex C lookup in the cascade engine route them into R32 slots.
 *
 * Order doesn't matter, this is a set selection. We sort the rendered
 * tiles by FIFA rank so the most plausible picks surface first.
 */

import type React from "react";
import { useEffect, useMemo } from "react";

import type {
  Bracket,
  GroupStanding,
  MatchPrediction,
  TeamId,
  Tournament,
} from "@tournamental/bracket-engine";
import {
  computeGroupStandings,
  isGroupComplete,
} from "@tournamental/bracket-engine";

import { TeamFlag } from "./TeamFlag";

interface ThirdsPickerProps {
  readonly tournament: Tournament;
  readonly bracket: Bracket;
  readonly onChange: (next: readonly TeamId[]) => void;
  readonly onClear: () => void;
}

interface ThirdRow {
  readonly teamId: TeamId;
  readonly groupId: string;
  readonly teamName: string;
  readonly fifaRank: number;
  readonly points: number;
  readonly goalDiff: number;
  readonly goalsFor: number;
}

const REQUIRED = 8;

export function ThirdsPicker(props: ThirdsPickerProps): JSX.Element {
  const { tournament, bracket, onChange, onClear } = props;

  const { rows, groupsComplete } = useMemo(() => {
    const out: ThirdRow[] = [];
    let allComplete = true;
    for (const g of tournament.groups) {
      const complete = isGroupComplete(g.id, tournament, bracket.matchPredictions);
      if (!complete) {
        allComplete = false;
        continue;
      }
      const standings: readonly GroupStanding[] = computeGroupStandings(
        g.id,
        tournament,
        bracket.matchPredictions,
        bracket.groupTiebreakers[g.id],
      );
      if (standings.length < 3) continue;
      const third = standings[2];
      if (!third) continue;
      const team = tournament.teams.find((t) => t.id === third.teamCode);
      out.push({
        teamId: third.teamCode,
        groupId: g.id,
        teamName: team?.name ?? third.teamCode,
        fifaRank: team?.fifa_rank ?? 99,
        points: third.points,
        goalDiff: third.goalDiff,
        goalsFor: third.goalsFor,
      });
    }
    // Sort by FIFA rank (best first) so the most plausible picks sit at
    // the top. FIFA rank is a fair proxy for "how likely is this 3rd to
    // be among the best 8".
    out.sort((a, b) => a.fifaRank - b.fifaRank);
    return { rows: out, groupsComplete: allComplete };
  }, [tournament, bracket.matchPredictions, bracket.groupTiebreakers]);

  // The current set of valid 3rd-placer team-ids (one per complete
  // group). A team-id that's in `bracket.bestThirds` but NOT in this
  // set is a stale pick: the user picked it as a 3rd-placer, then
  // edited a group-stage result that bumped the team out of 3rd. The
  // cascade can't route a stale pick through Annex C, so we surface
  // it via the count + auto-prune so the UI counter and the cascade
  // agree on how many picks are usable. Tim 2026-06-02: the symptom
  // was "8 / 8 selected" displayed while the cascade emitted
  // annex_c_third_pool_incomplete (got 7).
  const validThirdIds = useMemo(
    () => new Set<TeamId>(rows.map((r) => r.teamId)),
    [rows],
  );
  const rawSelected = bracket.bestThirds ?? [];
  const validSelected = rawSelected.filter((t) => validThirdIds.has(t));
  const staleCount = rawSelected.length - validSelected.length;

  // Auto-prune stale picks the moment we detect them. Running this in
  // an effect (instead of inside render) keeps the React lifecycle
  // happy and only fires when there's a real mismatch.
  useEffect(() => {
    if (staleCount > 0 && rows.length > 0) {
      onChange(validSelected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleCount, rows.length]);

  const selected = new Set<TeamId>(validSelected);
  const selectedCount = selected.size;
  const atLimit = selectedCount >= REQUIRED;

  const toggle = (teamId: TeamId): void => {
    const next = new Set(selected);
    if (next.has(teamId)) {
      next.delete(teamId);
    } else {
      if (atLimit) return; // ignore extra picks once 8 are chosen
      next.add(teamId);
    }
    onChange([...next]);
  };

  if (!groupsComplete) {
    return (
      <div className="bracket-thirds-empty">
        <p className="bracket-empty-state">
          Finish the Group Stage first. We surface each group&apos;s 3rd-placed
          team here as soon as the group is fully picked.
        </p>
        <p className="bracket-thirds-empty-note">
          {rows.length} of {tournament.groups.length} groups complete.
        </p>
      </div>
    );
  }

  return (
    <div className="bracket-thirds-picker">
      <div
        className="bracket-thirds-explainer"
        role="note"
        aria-labelledby="thirds-explainer-heading"
      >
        <h3 id="thirds-explainer-heading" className="bracket-thirds-explainer-heading">
          Why this stage exists
        </h3>
        <p>
          The 2026 World Cup advances the top 2 from each group <em>plus</em>{" "}
          the 8 best 3rd-placed teams (out of 12). In real life FIFA breaks
          ties on those 12 thirds by goal difference, goals scored, then
          discipline, then a drawing of lots. Tournamental only asks you to
          pick a winner / draw / loser for each match (not the score line),
          so we can&apos;t deterministically rank the 12 thirds beyond their
          points record.
        </p>
        <p>
          Pick the <strong>8</strong> you think will have the strongest
          records. We then route them into the Round of 32 using FIFA&apos;s
          official Annex C lookup table.
        </p>
      </div>

      <div className="bracket-thirds-toolbar">
        <span
          className="bracket-thirds-count"
          aria-live="polite"
          data-complete={selectedCount === REQUIRED ? "true" : undefined}
        >
          <strong>{selectedCount}</strong> / {REQUIRED} selected
        </span>
        <div className="bracket-thirds-toolbar-actions">
          <button
            type="button"
            className="bracket-btn bracket-btn-text"
            onClick={onClear}
            disabled={selectedCount === 0}
            aria-label="Clear selections"
          >
            Clear
          </button>
        </div>
      </div>

      <ul className="bracket-thirds-grid" role="listbox" aria-label="12 third-placed teams">
        {rows.map((r) => {
          const isSelected = selected.has(r.teamId);
          const disabled = !isSelected && atLimit;
          // Inline the team's flag URL as a CSS custom property so
          // the tile's ::before pseudo can render it as a blurred,
          // full-bleed background (matches the .km-team treatment on
          // the knockout-stage cards). Tim 2026-06-03.
          const style = {
            "--km-team-bg": `url(/flags/${r.teamId}.svg)`,
          } as React.CSSProperties;
          return (
            <li key={r.teamId}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={disabled || undefined}
                className={`bracket-thirds-tile ${isSelected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}
                style={style}
                onClick={() => toggle(r.teamId)}
              >
                <span className="bracket-thirds-tile-group">3{r.groupId}</span>
                <span
                  className="bracket-thirds-tile-rank"
                  aria-label={`FIFA rank ${r.fifaRank}`}
                >
                  FR {r.fifaRank}
                </span>
                <span className="bracket-thirds-tile-flag" aria-hidden="true">
                  <TeamFlag code={r.teamId} size="md" />
                </span>
                <span className="bracket-thirds-tile-name">{r.teamName}</span>
                <span className="bracket-thirds-tile-check" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selectedCount < REQUIRED && (
        <p className="bracket-thirds-hint" role="status">
          Pick {REQUIRED - selectedCount} more to unlock the Round of 32.
        </p>
      )}
    </div>
  );
}

/**
 * Helper used by the global AutoPick handler. Given the tournament + the
 * current bracket, returns the 8 third-placers with the best FIFA rank
 * (preferring lower-ranked = better teams). If fewer than 8 groups are
 * complete, returns whatever subset is available. Order is canonical
 * (alphabetical by team id) since order doesn't matter for the cascade.
 */
export function autoPickTop8Thirds(
  tournament: Tournament,
  matchPredictions: Record<string, MatchPrediction>,
  groupTiebreakers: Bracket["groupTiebreakers"],
): readonly TeamId[] {
  const candidates: Array<{ teamId: TeamId; fifaRank: number }> = [];
  for (const g of tournament.groups) {
    if (!isGroupComplete(g.id, tournament, matchPredictions)) continue;
    const standings = computeGroupStandings(
      g.id,
      tournament,
      matchPredictions,
      groupTiebreakers[g.id],
    );
    if (standings.length < 3) continue;
    const third = standings[2];
    if (!third) continue;
    const team = tournament.teams.find((t) => t.id === third.teamCode);
    candidates.push({ teamId: third.teamCode, fifaRank: team?.fifa_rank ?? 99 });
  }
  candidates.sort((a, b) => a.fifaRank - b.fifaRank);
  return candidates.slice(0, 8).map((c) => c.teamId).sort();
}
