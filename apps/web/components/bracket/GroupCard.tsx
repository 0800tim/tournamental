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

import { useTranslations } from "next-intl";
import type React from "react";
import { useState } from "react";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

function safeTRaw(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const fn = (t as unknown as { raw?: (k: string) => unknown }).raw;
    if (typeof fn !== "function") return fallback;
    const out = fn.call(t, key);
    if (typeof out !== "string" || out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

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
import { hostCityByMatchNumber } from "@/lib/host-cities";
import type { MatchOdds } from "@/lib/odds/types";
import type { ResultedMatch } from "./BracketBuilder";
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
  /** Recorded match results keyed by `matchId` (= String(match_no)).
   *  Drives the resulted-state rendering on each MatchPredictionRow.
   *  Empty map until the page-level fetch lands. Tim 2026-06-12. */
  readonly resultsByMatch?: ReadonlyMap<string, ResultedMatch>;
  readonly onChangeMatch: (next: MatchPrediction) => void;
  readonly onChangeTiebreaker: (next: GroupTiebreaker) => void;
  /** Optional per-group auto-pick. When provided the header surfaces a
   * small ⚡ button that fills the 6 matches of this group only,
   * using the same odds-favourite rule as the page-level Auto-pick. */
  readonly onAutoPickGroup?: (groupId: string) => void | Promise<void>;
  /** Initial expanded state. Lets the parent auto-expand the first
   * incomplete group on mount (Tim 2026-05-22). After mount the user
   * controls the state; changes to this prop are ignored so we don't
   * fight a user who's manually collapsed an auto-expanded group. */
  readonly initialExpanded?: boolean;
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
    resultsByMatch,
    onChangeMatch,
    onChangeTiebreaker,
    onAutoPickGroup,
    initialExpanded,
  } = props;

  const t = useTranslations();
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
  // Whether there's a genuine tie regardless of whether the user has
  // already saved a tiebreaker. We need this so the control hides when
  // there's a clear 1st/2nd (Tim 2026-05-21) but stays mounted while
  // the user keeps adjusting an already-broken tie.
  const tiesIgnoringTiebreaker = predictedCount === 0
    ? []
    : detectTiesNeedingTiebreaker(standings, {
        tournament,
        groupId: group.id,
        predictions: matchPredictions,
      });
  const needsTiebreaker = tiesIgnoringTiebreaker.length > 0;

  // Accordion applies at every viewport (Tim 2026-05-22). The parent
  // (BracketBuilder) seeds `initialExpanded=true` for the first
  // incomplete group on mount; everything else starts collapsed for
  // a clean SSR pass.
  const [expanded, setExpanded] = useState(initialExpanded ?? false);
  // Confirmation modal for the per-group auto-pick. Tim 2026-05-21:
  // tapping the lightning lozenge must warn first because it overwrites
  // any picks the user has already made in this group.
  const [showAutoPickConfirm, setShowAutoPickConfirm] = useState(false);
  const bodyId = `bracket-group-body-${group.id}`;

  // When the group is fully predicted AND no ties remain, surface the
  // 1st-place (gold) and 2nd-place (silver) teams in the collapsed
  // header. Tim 2026-05-21: at a glance the user wants to see who
  // advances from each group without opening the accordion.
  const headerHighlightsResolved = complete && ties.length === 0;
  const firstPlaceCode = headerHighlightsResolved ? standings[0]?.teamCode ?? null : null;
  const secondPlaceCode = headerHighlightsResolved ? standings[1]?.teamCode ?? null : null;

  // Position-indicator pip per team chip in the group header. Built
  // from the live standings (index+1) so the number reflects the
  // user's *current* predicted order, including any tiebreaker
  // resolution. Tim 2026-06-06: show as soon as any matches are
  // predicted; before that the standings are all-zero and a 1/2/3/4
  // would be misleadingly stub-ordered.
  const positionByCode = new Map<string, number>();
  if (predictedCount > 0) {
    standings.forEach((s, i) => positionByCode.set(s.teamCode, i + 1));
  }

  return (
    <div
      className="bracket-group"
      data-group-id={group.id}
      data-collapsed={expanded ? undefined : "true"}
    >
      <button
        type="button"
        className="bracket-group-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <span className="bracket-group-head-titlerow">
          <h3 className="bracket-group-head-title">{(() => {
            try {
              const out = t("bracket.group.label", { id: group.id });
              if (typeof out === "string" && out !== "bracket.group.label") return out;
            } catch { /* fall through */ }
            return `Group ${group.id}`;
          })()}</h3>
          <span className="bracket-group-progress" aria-live="polite">
            {predictedCount} / {groupFixtures.length} predicted
          </span>
          <span className="bracket-group-head-chevron" aria-hidden="true">
            {expanded ? "▼" : "▶"}
          </span>
        </span>
        <span
          className="bracket-group-head-teams"
          aria-hidden="true"
          data-complete={headerHighlightsResolved ? "true" : undefined}
        >
          {group.team_ids.map((code) => {
            const advance =
              code === firstPlaceCode
                ? "1"
                : code === secondPlaceCode
                  ? "2"
                  : undefined;
            // Tim 2026-06-05: the chip's ::before pseudo paints the
            // flag SVG as a blurred full-bleed background (same trick
            // as .bracket-thirds-tile and .km-team). Inline the URL
            // as a custom property so the pseudo can resolve it
            // without per-team CSS rules.
            const tileStyle = {
              "--km-team-bg": `url(/flags/${code}.svg)`,
            } as React.CSSProperties;
            const position = positionByCode.get(code);
            return (
              <span
                key={code}
                className="bracket-group-head-team"
                data-advance={advance}
                style={tileStyle}
              >
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
                {position && (
                  <span
                    className="bracket-group-head-team-pos"
                    data-pos={position}
                    aria-hidden="true"
                  >
                    {position}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      </button>
      {onAutoPickGroup ? (
        <div className="bracket-group-autopick-row">
          <button
            type="button"
            className="bracket-group-autopick"
            onClick={() => setShowAutoPickConfirm(true)}
            aria-label={`Auto-pick all 6 matches in Group ${group.id}`}
            title={`Auto-pick Group ${group.id} from live odds`}
          >
            <span className="bracket-group-autopick-icon" aria-hidden="true">⚡</span>
          </button>
        </div>
      ) : null}

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
              result={resultsByMatch?.get(id) ?? null}
              hostCity={hostCityByMatchNumber(f.match_no)}
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

        {/* Only show the tiebreaker UI when there's an actual tie to
         * resolve (regardless of whether the user has already saved a
         * tiebreaker for it). Once the standings have a clear 1st/2nd
         * via primary metrics, hide the panel entirely (Tim 2026-05-21).
         * The user can still re-rank tied teams freely while the panel
         * is open; saving doesn't unmount us because we check the
         * tieless detection separately. */}
        {needsTiebreaker && (
          <TiebreakerControl
            group={group}
            tiedBlocks={tiesIgnoringTiebreaker}
            standings={standings}
            tiebreaker={tiebreaker}
            onChangeTiebreaker={onChangeTiebreaker}
          />
        )}
      </div>
      {showAutoPickConfirm && onAutoPickGroup ? (
        <div
          className="bracket-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`group-${group.id}-autopick-title`}
          onClick={() => setShowAutoPickConfirm(false)}
        >
          <div
            className="bracket-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id={`group-${group.id}-autopick-title`}
              className="bracket-modal-title"
            >
              ⚡ Auto-pick Group {group.id}?
            </h3>
            <p className="bracket-modal-body">
              This will <strong>clear any picks you&apos;ve already made in
              Group {group.id}</strong> and replace them with the favourites
              from live Polymarket odds. The rest of your bracket stays
              untouched. You can edit any pick afterwards.
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
                onClick={() => {
                  setShowAutoPickConfirm(false);
                  onAutoPickGroup(group.id);
                }}
                autoFocus
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const t = useTranslations();
  const tiePositions = new Set<number>();
  for (const tie of ties) for (const p of tie.positions) tiePositions.add(p);

  return (
    <div className="bracket-standings" aria-label={safeT(t, "bracket.standings.heading", "PREDICTED STANDINGS")}>
      <h4>{safeT(t, "bracket.standings.heading", "PREDICTED STANDINGS")}</h4>
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
  /** Tied blocks the user must rank (tiebreaker not yet applied). */
  readonly tiedBlocks: ReturnType<typeof detectTiesNeedingTiebreaker>;
  readonly tiebreaker?: GroupTiebreaker;
  readonly onChangeTiebreaker: (next: GroupTiebreaker) => void;
}

function TiebreakerControl({
  group,
  standings,
  tiedBlocks,
  tiebreaker,
  onChangeTiebreaker,
}: TiebreakerControlProps) {
  // The full 4-team order, derived from the live standings each render.
  // The tiebreaker only resolves ties WITHIN a block, so non-tied teams'
  // positions are fixed by primary metrics. We compose the full ranked
  // list on every move by re-using standings order for non-tied teams
  // and the user's local block order for tied ones.
  const fullOrder = standings.map((s) => s.teamCode);

  const commitBlockOrder = (blockTeams: readonly string[]): void => {
    // Substitute the block's new order back into the full standings order
    // at the same positions, then write the whole 4-team list.
    const positions: number[] = [];
    for (const c of blockTeams) {
      const idx = fullOrder.indexOf(c);
      if (idx >= 0) positions.push(idx);
    }
    positions.sort((a, b) => a - b);
    const next = [...fullOrder];
    for (let k = 0; k < positions.length; k += 1) {
      next[positions[k]!] = blockTeams[k]!;
    }
    if (next.length !== 4) return;
    onChangeTiebreaker({
      groupId: group.id,
      rankedTeams: next as unknown as GroupTiebreaker["rankedTeams"],
      setAt: new Date().toISOString(),
    });
  };

  return (
    <div
      className="bracket-tiebreaker"
      role="group"
      aria-label="Tiebreaker, rank tied teams"
    >
      <h4>Tiebreaker, rank tied teams</h4>
      <p className="bracket-tiebreaker-hint">
        {tiedBlocks.length === 1
          ? `${tiedBlocks[0]!.teamCodes.join(", ")} are tied on points + goal difference. Drag (desktop) or use the arrows to rank them.`
          : "Multiple ties detected. Rank each tied block below."}
      </p>
      {tiedBlocks.map((block, bIdx) => (
        <TiebreakerBlock
          key={`block-${bIdx}-${block.teamCodes.join("-")}`}
          standings={standings}
          block={block}
          tiebreaker={tiebreaker}
          onCommit={commitBlockOrder}
        />
      ))}
    </div>
  );
}

interface TiebreakerBlockProps {
  readonly standings: readonly GroupStanding[];
  readonly block: { readonly positions: readonly number[]; readonly teamCodes: readonly string[] };
  readonly tiebreaker?: GroupTiebreaker;
  readonly onCommit: (blockTeams: readonly string[]) => void;
}

function TiebreakerBlock({ standings, block, tiebreaker, onCommit }: TiebreakerBlockProps) {
  // Order this block by current standings (which already honour any saved
  // tiebreaker), so the visible order matches "Predicted standings".
  const ordered = standings
    .filter((s) => block.teamCodes.includes(s.teamCode))
    .map((s) => s.teamCode);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const move = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0) return;
    if (from >= ordered.length || to >= ordered.length) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onCommit(next);
  };

  return (
    <ol className="bracket-tiebreaker-list">
      {ordered.map((code, i) => {
        const overallPos = block.positions[i] ?? i + 1;
        const isFirst = i === 0;
        const isLast = i === ordered.length - 1;
        return (
          <li
            key={code}
            className="bracket-tiebreaker-row"
            draggable
            data-dragging={dragIndex === i ? "true" : undefined}
            data-drop-target={
              overIndex === i && dragIndex !== null && dragIndex !== i
                ? "true"
                : undefined
            }
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", code);
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOverIndex(i);
            }}
            onDragLeave={() => {
              setOverIndex((cur) => (cur === i ? null : cur));
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            <span className="bracket-tiebreaker-grip" aria-hidden="true">⋮⋮</span>
            <span className="bracket-pos">{overallPos}.</span>
            <span className="bracket-team-code">{code}</span>
            <span className="bracket-pos-tag">
              {POSITION_LABELS[overallPos - 1] ?? `Position ${overallPos}`}
            </span>
            <span className="bracket-controls">
              <button
                type="button"
                draggable={false}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  move(i, i - 1);
                }}
                disabled={isFirst}
                aria-label={`Rank ${code} higher`}
              >
                &uarr;
              </button>
              <button
                type="button"
                draggable={false}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  move(i, i + 1);
                }}
                disabled={isLast}
                aria-label={`Rank ${code} lower`}
              >
                &darr;
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
