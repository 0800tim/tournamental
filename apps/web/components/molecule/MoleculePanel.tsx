"use client";

/**
 * MoleculePanel — slide-in side panel for the selected team.
 *
 * Shows:
 *   - flag emoji + name
 *   - the user's predicted path through the bracket (R32 → ... → Final)
 *   - each match's W/D/L outcome pick + opponent
 *   - a tiny "predicted finish" pill (champion / runner-up / 3rd / out
 *     at QF / etc.)
 *
 * Pure presentation; reads CascadedBracket but doesn't mutate it.
 */

import type { CascadedBracket, Tournament } from "@vtorn/bracket-engine";

import type { FinalStage } from "@/lib/molecule/layout";

export interface MoleculePanelProps {
  teamCode: string | null;
  tournament: Tournament;
  cascaded: CascadedBracket | null;
  finalStageByTeam: ReadonlyMap<string, FinalStage>;
  flagEmojiByTeam: ReadonlyMap<string, string>;
  onClose: () => void;
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

export function MoleculePanel(props: MoleculePanelProps) {
  const { teamCode, tournament, cascaded, finalStageByTeam, flagEmojiByTeam, onClose } = props;
  if (!teamCode) return null;

  const team = tournament.teams.find((t) => t.id === teamCode);
  if (!team) return null;

  const fs = finalStageByTeam.get(teamCode) ?? "group";
  const pill = FINAL_STAGE_PILL[fs];

  // Find all matches in the cascade where this team appears as home / away.
  const matches = (cascaded?.knockouts ?? []).filter(
    (k) => k.home.team === teamCode || k.away.team === teamCode,
  );

  return (
    <aside className="molecule-panel" role="complementary" aria-labelledby="molecule-panel-title">
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
        <button
          type="button"
          aria-label="Close team panel"
          className="molecule-panel-close"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <section className="molecule-panel-body">
        <h3 className="molecule-panel-section">Predicted path</h3>
        {matches.length === 0 ? (
          <p className="molecule-panel-empty">
            No knockout matches predicted yet for {team.name}. Group-stage
            elimination predicted.
          </p>
        ) : (
          <ol className="molecule-panel-path">
            {matches.map((k) => {
              const opponentCode = k.home.team === teamCode ? k.away.team : k.home.team;
              const opponent = tournament.teams.find((t) => t.id === opponentCode);
              const won = k.effective_winner === teamCode;
              const lost = k.effective_winner && k.effective_winner !== teamCode;
              return (
                <li key={k.id} className="molecule-panel-path-row" data-result={won ? "win" : lost ? "loss" : "tbd"}>
                  <span className="molecule-panel-path-stage">
                    {STAGE_LABEL[k.stage] ?? k.stage.toUpperCase()}
                  </span>
                  <span className="molecule-panel-path-opp">
                    vs {opponent?.name ?? opponentCode ?? "TBD"}
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

      <footer className="molecule-panel-foot">
        <a className="molecule-panel-link" href={`/team/${team.id}`}>
          Open team page →
        </a>
      </footer>
    </aside>
  );
}
