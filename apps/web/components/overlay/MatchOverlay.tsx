/**
 * MatchOverlay, bottom-sheet card with the compact match-preview view.
 *
 * Renders a slimmed-down version of the match-preview surface: kickoff
 * label + venue, both team flags, and quick links to each team's
 * overlay (replaces self).
 *
 * Tim 2026-06-05: the "Full page →" header CTA and the "Open full
 * preview (Predict / H2H / Form / Lineup / Stats) →" footer CTA were
 * removed because the underlying `/match/[id]/preview` route doesn't
 * exist as a publishable surface yet. The overlay IS the preview
 * surface for now.
 */

"use client";

import { useMemo } from "react";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import {
  canonicalTeam,
  resolveMatch,
} from "@/app/match/[id]/preview/_lib/match-data";

import { Sheet } from "./Sheet";
import { useOverlay } from "./OverlayProvider";

interface MatchOverlayProps {
  readonly id: string;
  readonly depth?: number;
}

export function MatchOverlay(props: MatchOverlayProps) {
  const { id, depth = 0 } = props;
  const overlay = useOverlay();

  const data = useMemo(() => {
    const tournament = enrichTournamentTeams(
      loadFixtures2026(),
      canonicalTeamsRaw as CanonicalTeamsFile,
    );
    const match = resolveMatch(tournament, id);
    return { match };
  }, [id]);

  const { match } = data;

  if (!match) {
    return (
      <Sheet
        title="Match not found"
        depth={depth}
        onClose={overlay.close}
        idHint={`match-${id}`}
      >
        <p>We couldn&apos;t find a match with id &ldquo;{id}&rdquo;.</p>
      </Sheet>
    );
  }

  const home = match.homeCode ? canonicalTeam(match.homeCode) : undefined;
  const away = match.awayCode ? canonicalTeam(match.awayCode) : undefined;

  const homeName = home?.name ?? match.homeCode ?? "TBD";
  const awayName = away?.name ?? match.awayCode ?? "TBD";

  const kickoff = new Date(match.kickoffUtc);
  const kickoffLabel = formatKickoff(kickoff);

  return (
    <Sheet
      title={`${homeName} vs ${awayName}`}
      depth={depth}
      onClose={overlay.close}
      idHint={`match-${match.matchId}`}
    >
      <div className="vt-match-overlay">
        <header className="vt-match-overlay-meta">
          <span className="vt-match-overlay-stage">{match.stageLabel}</span>
          <time dateTime={match.kickoffUtc}>{kickoffLabel}</time>
          {match.venue && <span className="vt-match-overlay-venue">{match.venue}</span>}
        </header>

        <div className="vt-match-overlay-row">
          <SideCard
            code={match.homeCode}
            name={homeName}
            primary={home?.kit?.primary}
            slotLabel={match.homeSlotLabel}
            onOpenTeam={(code) => overlay.replace("team", { code })}
          />
          <span className="vt-match-overlay-vs" aria-hidden="true">
            VS
          </span>
          <SideCard
            code={match.awayCode}
            name={awayName}
            primary={away?.kit?.primary}
            slotLabel={match.awaySlotLabel}
            onOpenTeam={(code) => overlay.replace("team", { code })}
          />
        </div>
      </div>
    </Sheet>
  );
}

interface SideCardProps {
  readonly code?: string;
  readonly name: string;
  readonly primary?: string;
  readonly slotLabel?: string;
  readonly onOpenTeam: (code: string) => void;
}

function SideCard(props: SideCardProps) {
  const { code, name, primary, slotLabel, onOpenTeam } = props;
  if (!code) {
    return (
      <div className="vt-match-overlay-side vt-match-overlay-side-tbd">
        <span aria-hidden="true">?</span>
        <span>TBD</span>
        {slotLabel && (
          <span className="vt-match-overlay-slotlabel">{slotLabel}</span>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="vt-match-overlay-side"
      onClick={() => onOpenTeam(code)}
      aria-label={`Open ${name} team overlay`}
    >
      <TeamFlag
        code={code}
        name={name}
        accentColor={primary}
        size="lg"
        shape="circle"
        sparkle={false}
      />
      <span className="vt-match-overlay-name">{name}</span>
      <span className="vt-match-overlay-code">{code}</span>
    </button>
  );
}

function formatKickoff(d: Date): string {
  return d.toLocaleString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
