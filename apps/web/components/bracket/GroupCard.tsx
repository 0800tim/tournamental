/**
 * GroupCard, per-match prediction UI for a single group.
 *
 * The user predicts the outcome of each of the group's 6 matches; the
 * standings are *computed* from those predictions and rendered live in a
 * panel below the matches. Only when computed standings produce a tie
 * that points → goal-diff → goals-for → head-to-head can't break does
 * the user pick a tiebreaker.
 *
 * No drag-and-drop. No "move team up". The whole point of the prediction
 * game is to predict every match, the standings fall out of the
 * predictions, not the other way around.
 */

"use client";

import { useState } from "react";

import {
  computeGroupStandings,
  detectTiesNeedingTiebreaker,
  isGroupComplete,
  type Group,
  type GroupStanding,
  type GroupTiebreaker,
  type MatchPrediction,
  type Team,
  type Tournament,
} from "@tournamental/bracket-engine";

import { groupMatchId } from "@/lib/bracket/match-ids";
import type { MatchOdds } from "@/lib/odds/types";
import { GroupWinnerChips } from "../odds/GroupWinnerChips";
import { MatchPredictionRow } from "./MatchPredictionRow";

export interface GroupCardProps {
  readonly tournament: Tournament;
  readonly group: Group;
  readonly teams: ReadonlyMap<string, Team>;
  readonly matchPredictions: Record<string, MatchPrediction>;
  readonly tiebreaker?: GroupTiebreaker;
  /** Cloudflare-derived 2-letter country code; gates the affiliate
   * CTAs in any odds hover-cards. */
  readonly country?: string | null;
  /** When false, suppress all live-odds chips in this card (used by
   * tests that don't want network calls). */
  readonly showOddsChips?: boolean;
  /** Bulk-fetched odds keyed by `matchId` (= String(match_no) for group
   * fixtures). Passed through to MatchPredictionRow so the W/D/L
   * percentages render inline under each pick without firing 6 fetches
   * per group. */
  readonly oddsByMatch?: ReadonlyMap<string, MatchOdds>;
  readonly onChangeMatch: (next: MatchPrediction) => void;
  readonly onChangeTiebreaker: (next: GroupTiebreaker) => void;
  /** Optional per-group auto-pick. When provided the header surfaces a
   * small ⚡ button that fills the 6 matches of this group only,
   * using the same odds-favourite rule as the page-level Auto-pick. */
  readonly onAutoPickGroup?: (groupId: string) => void;
}

const POSITION_LABELS = [
  "1st (advances)",
  "2nd (advances)",
  "3rd (best-thirds pool)",
  "4th",
];

export function GroupCard(props: GroupCardProps) {
  const {
    tournament,
    group,
    teams,
    matchPredictions,
    tiebreaker,
    country,
    showOddsChips = true,
    oddsByMatch,
    onChangeMatch,
    onChangeTiebreaker,
    onAutoPickGroup,
  } = props;

  const groupFixtures = tournament.group_fixtures
    .filter((f) => f.group_id === group.id)
    .sort((a, b) => a.match_no - b.match_no);

  const standings = computeGroupStandings(group.id, tournament, matchPredictions, tiebreaker);
  const complete = isGroupComplete(group.id, tournament, matchPredictions);
  const predictedCount = groupFixtures.filter((f) => matchPredictions[groupMatchId(f)]).length;
  // Don't surface tiebreaker control until the user has *some* predictions
  //, an empty group has every team tied at 0 pts, but that's not a real
  // tie that needs resolution.
  const ties = predictedCount === 0
    ? []
    : detectTiesNeedingTiebreaker(standings, {
        tournament,
        groupId: group.id,
        predictions: matchPredictions,
        tiebreaker,
      });

  // Mobile-only accordion. Desktop CSS forces the body visible regardless
  // of this state, so we can safely start collapsed for the SSR pass.
  const [expanded, setExpanded] = useState(false);
  const bodyId = `bracket-group-body-${group.id}`;

  return (
    <div
      className="bracket-group"
      data-group-id={group.id}
      data-collapsed={expanded ? undefined : "true"}
    >
      <div className="bracket-group-head-row">
        <button
          type="button"
          className="bracket-group-head"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <h3>
            <span className="bracket-group-head-label">Group {group.id}</span>
            <span className="bracket-group-head-teams" aria-hidden="true">
              {group.team_ids.map((code, i) => (
                <span key={code} className="bracket-group-head-team">
                  <img
                    className="bracket-group-head-flag"
                    src={`/flags/${code}.svg`}
                    alt=""
                    width={16}
                    height={11}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="bracket-group-head-team-code">{code}</span>
                  {i < group.team_ids.length - 1 && (
                    <span className="bracket-group-head-team-sep">·</span>
                  )}
                </span>
              ))}
            </span>
          </h3>
          <span className="bracket-group-progress" aria-live="polite">
            {predictedCount} / {groupFixtures.length} predicted
          </span>
          <span className="bracket-group-head-chevron" aria-hidden="true">
            {expanded ? "▼" : "▶"}
          </span>
        </button>
        {onAutoPickGroup ? (
          <button
            type="button"
            className="bracket-group-autopick"
            onClick={(e) => {
              e.stopPropagation();
              onAutoPickGroup(group.id);
            }}
            aria-label={`Auto-pick all 6 matches in Group ${group.id}`}
            title={`Auto-pick Group ${group.id} from live odds`}
          >
            <span className="bracket-group-autopick-icon" aria-hidden="true">⚡</span>
            <span className="bracket-group-autopick-label">Auto-pick group</span>
          </button>
        ) : null}
      </div>

      <div id={bodyId} className="bracket-group-body">
        {showOddsChips && (
          <GroupWinnerChips
            groupId={group.id}
            teamCodes={group.team_ids as readonly string[]}
            teams={teams}
            country={country}
          />
        )}

        <div className="bracket-group-matches">
          {groupFixtures.map((f) => {
          const homeCode = group.team_ids[f.home_idx]!;
          const awayCode = group.team_ids[f.away_idx]!;
          const home = teams.get(homeCode);
          const away = teams.get(awayCode);
          const id = groupMatchId(f);
          if (!home || !away) return null;
          return (
            <MatchPredictionRow
              key={id}
              matchId={id}
              homeTeam={home}
              awayTeam={away}
              prediction={matchPredictions[id]}
              groupLabel={`Group ${group.id}`}
              kickoffIso={f.kickoff_utc}
              country={country}
              showOddsChip={showOddsChips}
              odds={oddsByMatch?.get(id) ?? null}
              onChange={onChangeMatch}
            />
          );
          })}
        </div>

        <PredictedStandingsPanel
          standings={standings}
          teams={teams}
          complete={complete}
          ties={ties}
        />

        {ties.length > 0 && (
          <TiebreakerControl
            group={group}
            standings={standings}
            ties={ties}
            tiebreaker={tiebreaker}
            onChangeTiebreaker={onChangeTiebreaker}
          />
        )}
      </div>
    </div>
  );
}

interface StandingsPanelProps {
  readonly standings: readonly GroupStanding[];
  readonly teams: ReadonlyMap<string, Team>;
  readonly complete: boolean;
  readonly ties: ReturnType<typeof detectTiesNeedingTiebreaker>;
}

function PredictedStandingsPanel({ standings, teams, complete, ties }: StandingsPanelProps) {
  const tiePositions = new Set<number>();
  for (const t of ties) for (const p of t.positions) tiePositions.add(p);

  return (
    <div className="bracket-standings" aria-label="Predicted standings">
      <h4>Predicted standings</h4>
      {standings.length === 0 ? (
        <p className="bracket-standings-hint">Pick the outcomes of each match to see predicted standings.</p>
      ) : (
        <ol className="bracket-standings-list">
          {standings.map((s, i) => {
            const team = teams.get(s.teamCode);
            const pos = i + 1;
            const advancing = pos <= 2;
            const wildcard = pos === 3;
            const tied = tiePositions.has(pos);
            return (
              <li
                key={s.teamCode}
                className={`bracket-standings-row ${
                  advancing ? "is-advance" : wildcard ? "is-wildcard" : "is-out"
                } ${tied ? "is-tied" : ""}`}
              >
                <span className="bracket-pos">{pos}.</span>
                <span className="bracket-team-code">{s.teamCode}</span>
                <span className="bracket-team-name">{team?.name ?? s.teamCode}</span>
                <span className="bracket-stat" title="Points">{s.points} pts</span>
                <span className="bracket-stat" title="Goal difference">
                  {s.goalDiff >= 0 ? `+${s.goalDiff}` : s.goalDiff} GD
                </span>
                <span className="bracket-stat-detail" title="Won-Drawn-Lost">
                  {s.wins}W {s.draws}D {s.losses}L
                </span>
                <span className="bracket-stat-detail" title="Goals for / against">
                  {s.goalsFor}:{s.goalsAgainst}
                </span>
                <span className="bracket-pos-tag">
                  {advancing ? "advances" : wildcard ? "best-thirds pool" : "out"}
                </span>
                {tied && <span className="bracket-tie-flag" aria-label="Tied, needs tiebreaker">tied</span>}
              </li>
            );
          })}
        </ol>
      )}
      {!complete && standings.some((s) => s.played > 0) && (
        <p className="bracket-standings-hint">
          Standings update live as you pick. Predict all 6 matches for a final order.
        </p>
      )}
    </div>
  );
}

interface TiebreakerControlProps {
  readonly group: Group;
  readonly standings: readonly GroupStanding[];
  readonly ties: ReturnType<typeof detectTiesNeedingTiebreaker>;
  readonly tiebreaker?: GroupTiebreaker;
  readonly onChangeTiebreaker: (next: GroupTiebreaker) => void;
}

function TiebreakerControl({
  group,
  standings,
  ties,
  tiebreaker,
  onChangeTiebreaker,
}: TiebreakerControlProps) {
  // The tiebreaker stores the user's full ranked-4 order. We seed it from
  // the current standings and let the user reorder ties.
  const initialOrder = (tiebreaker?.rankedTeams ?? standings.map((s) => s.teamCode)) as readonly string[];
  const [order, setOrder] = useState<readonly string[]>(initialOrder);

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    if (next.length === 4) {
      onChangeTiebreaker({
        groupId: group.id,
        rankedTeams: next as unknown as GroupTiebreaker["rankedTeams"],
        setAt: new Date().toISOString(),
      });
    }
  };

  return (
    <div className="bracket-tiebreaker" role="group" aria-label="Tiebreaker, rank tied teams">
      <h4>Tiebreaker, rank tied teams</h4>
      <p className="bracket-tiebreaker-hint">
        {ties.length === 1
          ? `${ties[0]!.teamCodes.join(", ")} are tied. Drag-rank the order you'd predict.`
          : `Multiple ties detected. Rank the full group below.`}
      </p>
      <ol className="bracket-tiebreaker-list">
        {order.map((code, i) => (
          <li key={code} className="bracket-tiebreaker-row">
            <span className="bracket-pos">{i + 1}.</span>
            <span className="bracket-team-code">{code}</span>
            <span className="bracket-pos-tag">{POSITION_LABELS[i]}</span>
            <span className="bracket-controls">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Rank ${code} higher`}
              >
                &uarr;
              </button>
              <button
                type="button"
                onClick={() => move(i, +1)}
                disabled={i === order.length - 1}
                aria-label={`Rank ${code} lower`}
              >
                &darr;
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
