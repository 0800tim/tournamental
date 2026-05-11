"use client";

/**
 * MoleculePanel, slide-in side panel for the selected team.
 *
 * v3: the panel now tells a full narrative of the team's run through
 * the user's predicted bracket. Sections, top to bottom:
 *
 *   1. Header, flag, name, terminal-state pill (OUT IN R16 / CHAMPION / …).
 *   2. Highlight-on-scene toggle (carried over from v2).
 *   3. GROUP STAGE, a rank pill (1ST / 2ND / 3RD / 4TH), a sentence
 *      ("Topped Group A with 7 points (+6 GD)") and three per-match
 *      rows (opponent flag + result + points).
 *   4. KNOCKOUT, the existing path-rows section. Empty for teams who
 *      didn't make it out of the group.
 *   5. Footer, link to the dedicated team page.
 *
 * Group-stage data comes from `lib/molecule/group-summary.ts`, which
 * uses the same standings computer as the bracket UI (so the panel and
 * the bracket-builder group table always agree).
 */

import { useMemo } from "react";

import type { Bracket, CascadedBracket, Tournament } from "@vtorn/bracket-engine";

import type { FinalStage } from "@/lib/molecule/layout";
import {
  buildGroupStageSummary,
  positionLabel,
  rankPillLabel,
  type GroupMatchRow,
  type GroupStageSummary,
} from "@/lib/molecule/group-summary";

export interface MoleculePanelProps {
  teamCode: string | null;
  tournament: Tournament;
  bracket: Bracket;
  cascaded: CascadedBracket | null;
  finalStageByTeam: ReadonlyMap<string, FinalStage>;
  flagEmojiByTeam: ReadonlyMap<string, string>;
  /** Toggle state, is this team's path replacing the default highlight? */
  highlightOverrideOn?: boolean;
  onHighlightOverrideChange?: (on: boolean) => void;
  onClose: () => void;
  /**
   * v6, capture mode. While true the panel hides UI controls (the
   * close button, the "Highlight on scene" toggle) so the DOM
   * snapshot used for the viral share image renders only the
   * champion hero + group stage + knockout sections. Toggled by
   * the capture helper for the duration of the snapshot.
   */
  captureMode?: boolean;
  /**
   * v6.1, "viral share landing" follow-up (2026-05-11). When the
   * selected team IS the predicted champion, the panel shows a tiny
   * "Podium" row right under the hero with the runner-up + 3rd-place
   * flags so any viewer glancing at the share image gets all three
   * medal positions without reading the knockout list. The codes are
   * derived once in the parent (MoleculeScene) so we don't duplicate
   * the cascade traversal here.
   */
  podiumPeek?: {
    readonly championCode: string | null;
    readonly runnerUpCode: string | null;
    readonly thirdPlaceCode: string | null;
  } | null;
  /**
   * Read-only mode. Suppresses the close button + the highlight-on-
   * scene toggle so the share-landing embed can render the panel for
   * strangers without giving them controls that imply edit-ability.
   * Differs from `captureMode` in that the slide-in animation + scroll
   * stay intact; only interactive affordances are hidden.
   */
  readOnly?: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  group: "Group stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  tp: "3rd-place playoff",
  f: "Final",
};

const FINAL_STAGE_PILL: Record<FinalStage, { label: string; bg: string; fg: string }> = {
  champion: { label: "PREDICTED CHAMPION", bg: "#f5c542", fg: "#1a1305" },
  runner_up: { label: "RUNNER-UP", bg: "#d8dde6", fg: "#1e2433" },
  third_place: { label: "BRONZE", bg: "#d8954f", fg: "#1e1006" },
  fourth_place: { label: "4TH PLACE", bg: "#7c6648", fg: "#fff" },
  qf: { label: "OUT IN QF", bg: "#ff9a3d", fg: "#1e1006" },
  r16: { label: "OUT IN R16", bg: "#7eb6e8", fg: "#0a0e1a" },
  r32: { label: "OUT IN R32", bg: "#566787", fg: "#fff" },
  group: { label: "OUT IN GROUP", bg: "#3a4360", fg: "#cdd5e7" },
};

function gdLabel(gd: number): string {
  if (gd > 0) return `+${gd}`;
  if (gd < 0) return `${gd}`;
  return "0";
}

function summarySentence(summary: GroupStageSummary): string {
  if (!summary.hasAnyPick || !summary.groupId) {
    return "No group-stage matches predicted yet.";
  }
  const head = positionLabel(summary.position, summary.groupId);
  const pts = summary.totalPoints;
  const gd = gdLabel(summary.goalDiff);
  if (summary.matches.every((m) => m.teamScore === null)) {
    // No scores set, omit the GD bit, it would always read +0.
    return `${head} with ${pts} ${pts === 1 ? "point" : "points"}.`;
  }
  return `${head} with ${pts} ${pts === 1 ? "point" : "points"} (${gd} GD).`;
}

export function MoleculePanel(props: MoleculePanelProps) {
  const {
    teamCode,
    tournament,
    bracket,
    cascaded,
    finalStageByTeam,
    flagEmojiByTeam,
    highlightOverrideOn = true,
    onHighlightOverrideChange,
    onClose,
    captureMode = false,
    podiumPeek = null,
    readOnly = false,
  } = props;
  /**
   * Hide interactive bits whenever we're in either capture mode or
   * read-only mode. Same surface area — different reason for hiding.
   */
  const suppressControls = captureMode || readOnly;

  const team = teamCode
    ? tournament.teams.find((t) => t.id === teamCode) ?? null
    : null;

  // Group-stage summary is derived; memoise so it doesn't recompute on
  // every parent rerender.
  const groupSummary = useMemo<GroupStageSummary | null>(() => {
    if (!teamCode) return null;
    return buildGroupStageSummary(tournament, bracket, teamCode);
  }, [tournament, bracket, teamCode]);

  if (!teamCode || !team) return null;

  const fs = finalStageByTeam.get(teamCode) ?? "group";
  const pill = FINAL_STAGE_PILL[fs];

  // Find all knockout matches in the cascade where this team appears.
  const koMatches = (cascaded?.knockouts ?? []).filter(
    (k) => k.home.team === teamCode || k.away.team === teamCode,
  );

  return (
    <aside
      className="molecule-panel"
      role="complementary"
      aria-labelledby="molecule-panel-title"
      data-capture-mode={captureMode ? "true" : "false"}
    >
      <header className="molecule-panel-head">
        <div className="molecule-panel-flag" aria-hidden>
          {flagEmojiByTeam.get(teamCode) ?? "·"}
        </div>
        <div className="molecule-panel-titles">
          <h2 id="molecule-panel-title" className="molecule-panel-title">
            {team.name}
          </h2>
          <span
            className="molecule-panel-pill"
            style={{ background: pill.bg, color: pill.fg }}
          >
            {pill.label}
          </span>
        </div>
        {suppressControls ? null : (
          <button
            type="button"
            aria-label="Close team panel"
            className="molecule-panel-close"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </header>

      <section className="molecule-panel-body">
        {suppressControls ? null : (
          <div className="molecule-panel-toolbar">
            <label className="molecule-panel-toggle">
              <input
                type="checkbox"
                checked={highlightOverrideOn}
                onChange={(e) => onHighlightOverrideChange?.(e.currentTarget.checked)}
              />
              <span className="molecule-panel-toggle-track" aria-hidden />
              <span className="molecule-panel-toggle-label">
                Highlight on scene
              </span>
            </label>
          </div>
        )}

        {/* Podium peek, only when this team is the predicted champion. */}
        {podiumPeek && podiumPeek.championCode === teamCode ? (
          <PodiumPeek
            championCode={podiumPeek.championCode}
            runnerUpCode={podiumPeek.runnerUpCode}
            thirdPlaceCode={podiumPeek.thirdPlaceCode}
            tournament={tournament}
            flagEmojiByTeam={flagEmojiByTeam}
          />
        ) : null}

        {/* ---------- GROUP STAGE ---------- */}
        {groupSummary && groupSummary.groupId ? (
          <section
            className="molecule-panel-section-block"
            aria-labelledby="molecule-panel-group-header"
          >
            <header className="molecule-panel-section-header">
              <h3 id="molecule-panel-group-header" className="molecule-panel-section">
                Group stage
              </h3>
              {groupSummary.position ? (
                <span
                  className="molecule-panel-rank-pill"
                  data-rank={String(groupSummary.position)}
                  aria-label={`Finished ${rankPillLabel(groupSummary.position)} in their group`}
                >
                  {rankPillLabel(groupSummary.position)}
                </span>
              ) : null}
            </header>
            <p className="molecule-panel-summary-line">
              {summarySentence(groupSummary)}
            </p>
            {groupSummary.matches.length > 0 ? (
              <ol className="molecule-panel-group-matches">
                {groupSummary.matches.map((m) => (
                  <GroupMatchRowView
                    key={m.matchId}
                    row={m}
                    tournament={tournament}
                  />
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}

        {/* ---------- KNOCKOUT ---------- */}
        <section
          className="molecule-panel-section-block"
          aria-labelledby="molecule-panel-knockout-header"
        >
          <header className="molecule-panel-section-header">
            <h3 id="molecule-panel-knockout-header" className="molecule-panel-section">
              Knockout
            </h3>
          </header>
          {koMatches.length === 0 ? (
            <p className="molecule-panel-empty">
              Eliminated at the group stage, no knockout matches in this team&apos;s
              predicted path.
            </p>
          ) : (
            <ol className="molecule-panel-path">
              {koMatches.map((k) => {
                const opponentCode =
                  k.home.team === teamCode ? k.away.team : k.home.team;
                const opponent = tournament.teams.find((t) => t.id === opponentCode);
                const won = k.effective_winner === teamCode;
                const lost = k.effective_winner && k.effective_winner !== teamCode;
                const oppFlagSrc = opponentCode ? `/flags/${opponentCode}.svg` : null;
                return (
                  <li
                    key={k.id}
                    className="molecule-panel-path-row"
                    data-result={won ? "win" : lost ? "loss" : "tbd"}
                  >
                    <span className="molecule-panel-path-stage">
                      {STAGE_LABEL[k.stage] ?? k.stage.toUpperCase()}
                    </span>
                    <span className="molecule-panel-path-opp">
                      <span className="molecule-panel-path-opp-flag" aria-hidden>
                        {oppFlagSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={oppFlagSrc}
                            alt=""
                            width={24}
                            height={16}
                            loading="lazy"
                          />
                        ) : (
                          <span className="molecule-panel-path-opp-flag-fallback">?</span>
                        )}
                      </span>
                      <span className="molecule-panel-path-opp-name">
                        vs {opponent?.name ?? opponentCode ?? "TBD"}
                      </span>
                    </span>
                    <span className="molecule-panel-path-result">
                      {won ? "WIN" : lost ? "OUT" : "TBD"}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </section>

      <footer className="molecule-panel-foot">
        <a className="molecule-panel-link" href={`/team/${team.id}`}>
          Open team page →
        </a>
      </footer>
    </aside>
  );
}

/**
 * One group-stage match row inside the panel. Renders:
 *   "vs MEX   W   3 pts"  with a small flag + 3-char opponent code.
 *
 * The opponent flag is the same `/flags/<code>.svg` SVG the knockout
 * rows use.
 */
function GroupMatchRowView({
  row,
  tournament,
}: {
  row: GroupMatchRow;
  tournament: Tournament;
}): React.ReactElement {
  const oppFlagSrc = `/flags/${row.opponentCode}.svg`;
  const opponentName = tournament.teams.find((t) => t.id === row.opponentCode)?.name ?? row.opponentName;
  const scoreLine =
    row.teamScore !== null && row.opponentScore !== null
      ? ` (${row.teamScore}-${row.opponentScore})`
      : "";
  return (
    <li
      className="molecule-panel-group-match"
      data-result={row.result.toLowerCase()}
      aria-label={`vs ${opponentName}, ${row.result}${scoreLine}, ${row.points} ${row.points === 1 ? "point" : "points"}`}
    >
      <span className="molecule-panel-group-match-opp">
        <span className="molecule-panel-path-opp-flag" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={oppFlagSrc} alt="" width={24} height={16} loading="lazy" />
        </span>
        <span className="molecule-panel-group-match-name">
          vs <strong>{row.opponentCode}</strong>
        </span>
      </span>
      <span className="molecule-panel-group-match-mid">
        <span className="molecule-panel-group-match-result" data-result={row.result.toLowerCase()}>
          {row.result}
        </span>
        {row.teamScore !== null && row.opponentScore !== null ? (
          <span className="molecule-panel-group-match-score">
            {row.teamScore}–{row.opponentScore}
          </span>
        ) : null}
      </span>
      <span className="molecule-panel-group-match-pts">
        {row.points} {row.points === 1 ? "pt" : "pts"}
      </span>
    </li>
  );
}

/**
 * Podium peek row, shown ONLY when the selected team is the predicted
 * champion. Three medal tiles, gold / silver / bronze, each with the
 * team's flag emoji + 3-letter code + ordinal pill. Renders nothing
 * when any of the three codes is missing — partial podiums look worse
 * than no podium.
 *
 * Why it lives inside the panel and not as a sibling of the molecule:
 * a viewer's eye anchors on the champion hero in the panel, so the
 * silver/bronze tiles sit closest to that anchor where the storytelling
 * payoff is strongest. The share-image capture sweeps the panel into
 * the right-hand strip so this tiny row ends up baked into the viral
 * PNG too.
 */
function PodiumPeek({
  championCode,
  runnerUpCode,
  thirdPlaceCode,
  tournament,
  flagEmojiByTeam,
}: {
  championCode: string | null;
  runnerUpCode: string | null;
  thirdPlaceCode: string | null;
  tournament: Tournament;
  flagEmojiByTeam: ReadonlyMap<string, string>;
}): React.ReactElement | null {
  const codeName = (code: string | null): string | null => {
    if (!code) return null;
    return tournament.teams.find((t) => t.id === code)?.name ?? code;
  };
  const championName = codeName(championCode);
  const runnerUpName = codeName(runnerUpCode);
  const thirdName = codeName(thirdPlaceCode);
  // Don't render unless we have all three — a partial podium reads as
  // a bug, not a feature.
  if (!championCode || !runnerUpCode || !thirdPlaceCode) return null;
  if (!championName || !runnerUpName || !thirdName) return null;
  return (
    <ol
      className="molecule-panel-podium"
      aria-label="Predicted podium"
      data-testid="molecule-panel-podium"
    >
      <li className="molecule-panel-podium-tile" data-rank="gold">
        <span className="molecule-panel-podium-cup" aria-hidden>
          🥇
        </span>
        <span className="molecule-panel-podium-flag" aria-hidden>
          {flagEmojiByTeam.get(championCode) ?? "🏳️"}
        </span>
        <span className="molecule-panel-podium-code">{championCode}</span>
      </li>
      <li className="molecule-panel-podium-tile" data-rank="silver">
        <span className="molecule-panel-podium-cup" aria-hidden>
          🥈
        </span>
        <span className="molecule-panel-podium-flag" aria-hidden>
          {flagEmojiByTeam.get(runnerUpCode) ?? "🏳️"}
        </span>
        <span className="molecule-panel-podium-code">{runnerUpCode}</span>
      </li>
      <li className="molecule-panel-podium-tile" data-rank="bronze">
        <span className="molecule-panel-podium-cup" aria-hidden>
          🥉
        </span>
        <span className="molecule-panel-podium-flag" aria-hidden>
          {flagEmojiByTeam.get(thirdPlaceCode) ?? "🏳️"}
        </span>
        <span className="molecule-panel-podium-code">{thirdPlaceCode}</span>
      </li>
    </ol>
  );
}
