/**
 * "Best 3rd Place" stage. Lives between Groups and the first knockout
 * round in the bracket tabs. Formats like the 2026 World Cup (8 of 12
 * thirds) and Rugby World Cup 2027 (4 of 6) advance the top 2 of each
 * group plus the best third-placed teams. The organiser ranks the
 * thirds by its tiebreaker rules, which end in steps we cannot compute
 * from outcome-only predictions (discipline, drawing of lots). So we
 * ask the user to consciously select the thirds, persist them into
 * `bracket.bestThirds`, then let the Annex C lookup in the cascade
 * engine route them into the knockout slots.
 *
 * Order doesn't matter, this is a set selection. We sort the rendered
 * tiles by the tournament's cross-group chain (predicted points, then
 * world ranking) so the most plausible picks surface first. The count
 * and the chain come from the tournament, not from this file.
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

import {
  bestThirdsTarget,
  rankThirds,
  rankingLabel,
  selectBestThirds,
  teamWorldRank,
  thirdsEntryStageLabel,
  thirdsTiebreakLabels,
  type ThirdCandidate,
} from "@/lib/bracket/thirds";

import { TeamFlag } from "./TeamFlag";

interface ThirdsPickerProps {
  readonly tournament: Tournament;
  readonly bracket: Bracket;
  readonly onChange: (next: readonly TeamId[]) => void;
  readonly onClear: () => void;
}

interface ThirdRow extends ThirdCandidate {
  readonly teamId: TeamId;
  readonly teamName: string;
  readonly worldRank: number;
}

export function ThirdsPicker(props: ThirdsPickerProps): JSX.Element {
  const { tournament, bracket, onChange, onClear } = props;
  const REQUIRED = bestThirdsTarget(tournament);
  const ranking = rankingLabel(tournament);

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
        standing: third,
        teamName: team?.name ?? third.teamCode,
        worldRank: teamWorldRank(team),
      });
    }
    // Best first by the tournament's cross-group chain (predicted
    // points, then world ranking once the score-based criteria are
    // level) so the most plausible picks sit at the top.
    return { rows: rankThirds(tournament, out), groupsComplete: allComplete };
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
          This tournament advances the top {tournament.advancement.automatic_per_group}{" "}
          from each group <em>plus</em> the {REQUIRED} best 3rd-placed teams
          (out of {tournament.groups.length}). In real life {ranking.body} ranks
          those thirds by points, then {thirdsTiebreakLabels(tournament).join(", ")},
          then steps like discipline or a drawing of lots. Tournamental only
          asks you to pick a winner / draw / loser for each match (not the
          score line), so we can&apos;t deterministically rank the thirds
          beyond their points record.
        </p>
        <p>
          Pick the <strong>{REQUIRED}</strong> you think will have the strongest
          records. We then route them into the {thirdsEntryStageLabel(tournament)}{" "}
          using the official allocation table.
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

      <ul
        className="bracket-thirds-grid"
        role="listbox"
        aria-label={`${tournament.groups.length} third-placed teams`}
      >
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
                  aria-label={`${ranking.long} ${r.worldRank}`}
                >
                  {ranking.short} {r.worldRank}
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
          Pick {REQUIRED - selectedCount} more to unlock the {thirdsEntryStageLabel(tournament)}.
        </p>
      )}
    </div>
  );
}

/**
 * Helper for an auto-pick handler. Given the tournament + the current
 * bracket, returns the best third-placers by the tournament's
 * cross-group chain, as many as the format advances. If fewer groups
 * are complete, returns whatever subset is available. Order is
 * canonical (alphabetical by team id) since order doesn't matter for
 * the cascade.
 */
export function autoPickBestThirds(
  tournament: Tournament,
  matchPredictions: Record<string, MatchPrediction>,
  groupTiebreakers: Bracket["groupTiebreakers"],
): readonly TeamId[] {
  const candidates: ThirdCandidate[] = [];
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
    candidates.push({ groupId: g.id, standing: third });
  }
  return [...selectBestThirds(tournament, candidates)].sort();
}
