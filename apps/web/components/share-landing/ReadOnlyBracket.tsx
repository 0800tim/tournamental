/**
 * ReadOnlyBracket, the full 104-pick bracket rendered as a static
 * view on the /s/<guid> share landing.
 *
 * Tim 2026-06-03: between the molecule and the printable poster, show
 * every match the owner predicted, grouped by stage. No interactivity:
 *   - Group stage: 12 group cards, each listing the 6 fixtures with
 *     the predicted outcome (1=home win / X=draw / 2=away win).
 *   - Best 8 3rds (FIFA 2026 specific): 8 teams the owner picked to
 *     advance via the third-place wildcard.
 *   - R32 / R16 / QF / SF + 3rd-place / Final: each fixture shows the
 *     predicted winner highlighted, the loser dimmed.
 *
 * When the viewer is the bracket owner (compared via useUser()), a
 * "Manage my bracket" CTA renders at the top so they can jump back
 * into the interactive builder.  When the viewer is a stranger, no
 * CTA renders.
 */

"use client";

import { useMemo, useState } from "react";

import {
  cascade,
  isGroupComplete,
  loadFixtures2026,
  type Bracket,
  type CascadedKnockout,
  type MatchPrediction,
  type StageId,
  type Tournament,
} from "@tournamental/bracket-engine";

import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import {
  enrichTournamentTeams,
  type CanonicalTeamsFile,
} from "@/lib/bracket/enrich";
import { useUser } from "@/lib/auth/useUser";
import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";

import "./read-only-bracket.css";

export interface ReadOnlyBracketProps {
  /** The owner's persisted bracket. */
  readonly bracket: Bracket;
  /**
   * The owner's auth user id, used to decide whether to show the
   * "Manage my bracket" CTA at the top.  When the page is visited by
   * a stranger this won't match the signed-in user; when visited by
   * the owner (or when no one is signed in), the CTA's visibility
   * is gated by the match.
   */
  readonly ownerUserId: string | null;
  /** Owner's handle, used for the "your" vs "their" copy. */
  readonly ownerHandle: string;
}

const STAGE_LABELS: Partial<Record<StageId, string>> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  tp: "Third-place playoff",
  f: "Final",
};

const KO_STAGES_IN_ORDER: readonly StageId[] = ["r32", "r16", "qf", "sf", "tp", "f"];

/** Build the enriched tournament once on mount (static JSON). */
function useEnrichedTournament(): Tournament {
  const [tournament] = useState<Tournament>(() => {
    const base = loadFixtures2026();
    return enrichTournamentTeams(base, canonicalTeamsRaw as CanonicalTeamsFile);
  });
  return tournament;
}

/** Resolve flag emoji + team name by 3-letter code from the canonical roster. */
function teamLite(code: string | null | undefined): {
  code: string;
  name: string;
  flag: string;
} {
  const safe = (code ?? "").toUpperCase();
  const file = canonicalTeamsRaw as CanonicalTeamsFile;
  const t = file.teams.find((x) => x.code === safe);
  return {
    code: safe || "TBD",
    name: t?.name ?? (safe || "TBD"),
    flag: t?.flag_emoji ?? "🏳️",
  };
}

export function ReadOnlyBracket(props: ReadOnlyBracketProps) {
  const { bracket, ownerUserId, ownerHandle } = props;
  const tournament = useEnrichedTournament();
  const auth = useUser();
  const viewerIsOwner =
    !!ownerUserId &&
    auth.status === "authenticated" &&
    !!auth.user?.id &&
    auth.user.id === ownerUserId;

  // Run the cascade so we know who plays whom at each KO stage,
  // independent of which slots the owner picked.  Wrapped in try/catch
  // so a malformed payload (missing matchPredictions, partial groups,
  // legacy schema, etc.) degrades to a "knockouts not predicted yet"
  // empty state instead of throwing and breaking the page.  Tim
  // 2026-06-03: defensive after a runtime crash on /s/0800tim.
  const cascaded = useMemo(() => {
    try {
      const safeBracket: Bracket = {
        matchPredictions: bracket.matchPredictions ?? {},
        knockoutPredictions: bracket.knockoutPredictions ?? {},
        groupTiebreakers: bracket.groupTiebreakers ?? {},
        bestThirds: bracket.bestThirds,
      } as Bracket;
      const input = bracketToCascadeInput(tournament, safeBracket, "share-viewer");
      return cascade(tournament, input);
    } catch {
      return { knockouts: [] as CascadedKnockout[] };
    }
  }, [tournament, bracket]);

  // Group knockouts by stage. The cascade output's `knockouts` array
  // may be empty (no picks yet, or the catch branch above) and that's
  // fine: the KO sections just render with all-TBD rows.
  const koByStage = useMemo(() => {
    const out = new Map<StageId, CascadedKnockout[]>();
    for (const stage of KO_STAGES_IN_ORDER) out.set(stage, []);
    const list = (cascaded.knockouts ?? []) as readonly CascadedKnockout[];
    for (const k of list) {
      const arr = out.get(k.stage);
      if (arr) arr.push(k);
    }
    return out;
  }, [cascaded]);

  return (
    <section className="rob" aria-labelledby="rob-title">
      <header className="rob-head">
        <h2 id="rob-title" className="rob-title">
          {viewerIsOwner ? "Your full bracket" : `@${ownerHandle}'s full bracket`}
        </h2>
        <p className="rob-sub">
          Match-by-match, all 104 picks. Read-only{viewerIsOwner ? "" : " — only the owner can edit"}.
        </p>
        {viewerIsOwner ? (
          <a className="rob-manage-cta" href="/world-cup-2026" data-testid="rob-manage-cta">
            ✏️ Manage my bracket
          </a>
        ) : null}
      </header>

      {/* Group stage */}
      <h3 className="rob-stage-head">Group stage</h3>
      <div className="rob-groups-grid">
        {tournament.groups.map((g) => (
          <ReadOnlyGroupCard
            key={g.id}
            tournament={tournament}
            bracket={bracket}
            groupId={g.id}
          />
        ))}
      </div>

      {/* Best 8 thirds (FIFA 2026) */}
      {bracket.bestThirds && bracket.bestThirds.length > 0 ? (
        <>
          <h3 className="rob-stage-head">Best 8 third-placed teams (advance to R32)</h3>
          <ul className="rob-thirds-list" aria-label="Best 8 third-placed teams">
            {bracket.bestThirds.map((code: string) => {
              const t = teamLite(code);
              return (
                <li className="rob-thirds-row" key={code}>
                  <span className="rob-flag" aria-hidden>{t.flag}</span>
                  <span className="rob-team-code">{t.code}</span>
                  <span className="rob-team-name">{t.name}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {/* Knockouts: one section per stage */}
      {KO_STAGES_IN_ORDER.map((stage) => {
        const kos = koByStage.get(stage) ?? [];
        if (kos.length === 0) return null;
        return (
          <ReadOnlyKnockoutSection
            key={stage}
            stage={stage}
            knockouts={kos}
            predictions={bracket.knockoutPredictions}
          />
        );
      })}

      <p className="rob-footnote">
        {viewerIsOwner
          ? "All your picks save automatically as you tweak them on the bracket page."
          : `Built on Tournamental. Want your own bracket? Open the bracket builder.`}
      </p>
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────
// Internal sub-components
// ───────────────────────────────────────────────────────────────────

function ReadOnlyGroupCard({
  tournament,
  bracket,
  groupId,
}: {
  tournament: Tournament;
  bracket: Bracket;
  groupId: string;
}) {
  const group = tournament.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const fixtures = tournament.group_fixtures.filter((f) => f.group_id === groupId);
  // isGroupComplete signature: (groupId, tournament, predictions).
  const complete = isGroupComplete(groupId, tournament, bracket.matchPredictions);
  // Resolve team codes from the group's team_ids via the home_idx /
  // away_idx fields on each fixture.
  const teamIds = group.team_ids;

  return (
    <div className="rob-group" data-complete={complete ? "true" : "false"}>
      <div className="rob-group-head">
        <span className="rob-group-letter">Group {group.id.toUpperCase()}</span>
        {!complete ? (
          <span className="rob-group-incomplete" title="Owner has not predicted every match in this group">
            incomplete
          </span>
        ) : null}
      </div>
      <ul className="rob-fixture-list">
        {fixtures.map((f) => {
          const pick = bracket.matchPredictions[String(f.match_no)];
          const home = teamLite(teamIds[f.home_idx]);
          const away = teamLite(teamIds[f.away_idx]);
          const outcome = pick?.outcome ?? null;
          return (
            <li className="rob-fixture-row" key={f.match_no}>
              <span className="rob-fixture-num">#{f.match_no}</span>
              <span
                className="rob-fixture-team rob-fixture-team--home"
                data-result={outcomeResult(outcome, "home")}
              >
                <span className="rob-flag" aria-hidden>{home.flag}</span>
                <span className="rob-team-code">{home.code}</span>
              </span>
              <span className="rob-fixture-vs">
                {outcome === "draw" ? "DRAW" : "vs"}
              </span>
              <span
                className="rob-fixture-team rob-fixture-team--away"
                data-result={outcomeResult(outcome, "away")}
              >
                <span className="rob-team-code">{away.code}</span>
                <span className="rob-flag" aria-hidden>{away.flag}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function outcomeResult(
  outcome: MatchPrediction["outcome"] | null,
  side: "home" | "away",
): "win" | "loss" | "draw" | "tbd" {
  if (outcome === null) return "tbd";
  if (outcome === "draw") return "draw";
  if (outcome === "home_win") return side === "home" ? "win" : "loss";
  if (outcome === "away_win") return side === "away" ? "win" : "loss";
  return "tbd";
}

function ReadOnlyKnockoutSection({
  stage,
  knockouts,
  predictions,
}: {
  stage: StageId;
  knockouts: readonly CascadedKnockout[];
  predictions: Record<string, MatchPrediction>;
}) {
  return (
    <>
      <h3 className="rob-stage-head">{STAGE_LABELS[stage]}</h3>
      <ul className="rob-ko-list">
        {knockouts.map((k) => {
          const homeCode = k.home.team ?? null;
          const awayCode = k.away.team ?? null;
          const home = teamLite(homeCode);
          const away = teamLite(awayCode);
          const pick = predictions[k.id];
          const winnerSide: "home" | "away" | null =
            pick?.outcome === "home_win"
              ? "home"
              : pick?.outcome === "away_win"
                ? "away"
                : null;
          return (
            <li className="rob-ko-row" key={k.id}>
              <span className="rob-ko-id">{k.id.toUpperCase()}</span>
              <span
                className="rob-ko-team rob-ko-team--home"
                data-winner={winnerSide === "home" ? "true" : "false"}
              >
                <span className="rob-flag" aria-hidden>{home.flag}</span>
                <span className="rob-team-code">{home.code}</span>
                <span className="rob-team-name">{home.name}</span>
              </span>
              <span className="rob-ko-vs">vs</span>
              <span
                className="rob-ko-team rob-ko-team--away"
                data-winner={winnerSide === "away" ? "true" : "false"}
              >
                <span className="rob-team-name">{away.name}</span>
                <span className="rob-team-code">{away.code}</span>
                <span className="rob-flag" aria-hidden>{away.flag}</span>
              </span>
              <span className="rob-ko-result" data-state={winnerSide ? "picked" : "tbd"}>
                {winnerSide === "home"
                  ? `${home.code} advances`
                  : winnerSide === "away"
                    ? `${away.code} advances`
                    : "not picked"}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
