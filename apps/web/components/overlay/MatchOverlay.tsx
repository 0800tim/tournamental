/**
 * MatchOverlay, bottom-sheet card with the compact match-preview view.
 *
 * Layout (top → bottom):
 *   - Stage chip: "Group A · Match 1" or "Round of 32 · Match 73",
 *     small gold-bordered lozenge.
 *   - Two team side-cards (unchanged): both flags, names, codes,
 *     tappable into the team overlay.
 *   - When block: full date, large user-local kickoff time, smaller
 *     venue-local kickoff time. When the user's timezone matches the
 *     venue timezone, collapses to a single line.
 *   - Where block: city + host-country flag + country name, real
 *     stadium name, FIFA tournament name in quotes + formatted
 *     stadium capacity.
 *
 * The When block formats date/time client-side via `Intl.DateTimeFormat`
 * using the runtime-resolved locale + timezone. On first paint
 * (SSR / pre-hydration) we render both lines in the venue timezone so
 * the markup is deterministic; a `useEffect` swaps to the user's
 * resolved timezone after mount.
 *
 * Tim 2026-06-05: the "Full page →" header CTA and the "Open full
 * preview (Predict / H2H / Form / Lineup / Stats) →" footer CTA were
 * removed because the underlying `/match/[id]/preview` route doesn't
 * exist as a publishable surface yet. The overlay IS the preview
 * surface for now.
 */

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import { hostCityById, type HostCity } from "@/lib/host-cities";
import { useLiveMatchStatus } from "@/lib/bracket/use-live-status";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import {
  canonicalTeam,
  resolveMatch,
} from "@/app/match/[id]/preview/_lib/match-data";

import { Sheet } from "./Sheet";
import { useOverlay } from "./OverlayProvider";

const FIFA_2026_TID = "fifa-wc-2026";

interface MatchResultSummary {
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}

/** One-shot fetch of recorded results, polled every 60s. Same surface
 *  the bracket + calendar pages use, scoped here to the single match
 *  whose overlay is currently open. Tim 2026-06-14. */
function useMatchResult(matchId: string): MatchResultSummary | null {
  const [result, setResult] = useState<MatchResultSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/v1/match-results/${FIFA_2026_TID}`, {
          credentials: "same-origin",
        });
        if (!r.ok) return;
        const body = (await r.json()) as {
          results?: ReadonlyArray<{
            match_id: string;
            homeScore: number | null;
            awayScore: number | null;
          }>;
        };
        if (cancelled || !body.results) return;
        const row = body.results.find((x) => x.match_id === matchId);
        setResult(
          row ? { homeScore: row.homeScore, awayScore: row.awayScore } : null,
        );
      } catch {
        /* silent — overlay falls back to pre-result rendering */
      }
    }
    void load();
    const id = window.setInterval(load, 60_000);
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [matchId]);
  return result;
}

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

  // Tim 2026-06-14: resulted state + live state for this match.
  // Both polled every 60s by their respective hooks so the overlay
  // updates without the user closing/reopening it.
  const result = useMatchResult(match.matchId);
  const liveByMatch = useLiveMatchStatus(FIFA_2026_TID);
  const live = liveByMatch.get(match.matchId) ?? null;
  const homeScore = result?.homeScore ?? (live ? live.homeScore : null);
  const awayScore = result?.awayScore ?? (live ? live.awayScore : null);
  const matchState: "ft" | "live" | "future" = result
    ? "ft"
    : live
      ? "live"
      : "future";

  const hostCity = hostCityById(match.hostCityId);
  const stageChipText = `${match.stageLabel} · Match ${match.matchNo}`;
  const someTbd = !match.homeCode || !match.awayCode;
  const bothTbd = !match.homeCode && !match.awayCode;
  const tbdNote = someTbd
    ? bothTbd
      ? "Teams shown once the previous stage closes"
      : "Opponent shown once the previous stage closes"
    : null;

  return (
    <Sheet
      title={`${homeName} vs ${awayName}`}
      depth={depth}
      onClose={overlay.close}
      idHint={`match-${match.matchId}`}
    >
      <div className="vt-match-overlay">
        {tbdNote && (
          <p className="vt-match-overlay-tbd-note">({tbdNote})</p>
        )}
        <header className="vt-match-overlay-meta">
          <span className="vt-match-overlay-stage-chip">{stageChipText}</span>
          {matchState === "ft" && (
            <span className="vt-match-overlay-status" data-state="ft">
              FT
            </span>
          )}
          {matchState === "live" && live && (
            <span className="vt-match-overlay-status" data-state="live">
              <span className="vt-match-overlay-status-dot" aria-hidden="true" />
              LIVE
              <span className="vt-match-overlay-status-clock">{live.clock}</span>
            </span>
          )}
        </header>

        <div className="vt-match-overlay-row" data-state={matchState}>
          <SideCard
            code={match.homeCode}
            name={homeName}
            primary={home?.kit?.primary}
            slotLabel={match.homeSlotLabel}
            onOpenTeam={(code) => overlay.replace("team", { code })}
            score={homeScore}
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
            score={awayScore}
          />
        </div>

        {match.kickoffUtc && (
          <WhenBlock kickoffUtc={match.kickoffUtc} hostCity={hostCity} />
        )}

        {hostCity && <WhereBlock hostCity={hostCity} />}
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
  /** Current score (FT for resulted matches, live for in-progress).
   *  When non-null, renders as a big bold overlay across the flag tile.
   *  Tim 2026-06-14. */
  readonly score?: number | null;
}

function SideCard(props: SideCardProps) {
  const { code, name, primary, slotLabel, onOpenTeam, score } = props;
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
  // Inline a CSS variable carrying the team's flag URL so the
  // `.vt-match-overlay-side[data-team-bg]::before` pseudo can paint a
  // blurred full-bleed flag behind the circular chip + name. Same
  // pattern the bracket's `.km-team` cells use.
  const bgStyle: CSSProperties = {
    ["--vt-side-bg" as string]: `url(/flags/${code}.svg)`,
  };
  return (
    <button
      type="button"
      className="vt-match-overlay-side"
      data-team-bg=""
      style={bgStyle}
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
      {typeof score === "number" && (
        <span
          className="vt-match-overlay-score"
          aria-label={`${name} score: ${score}`}
        >
          {score}
        </span>
      )}
    </button>
  );
}

// ---------- When block ----------

interface WhenBlockProps {
  readonly kickoffUtc: string;
  readonly hostCity?: HostCity;
}

function WhenBlock(props: WhenBlockProps) {
  const { kickoffUtc, hostCity } = props;
  const venueTz = hostCity?.timezone ?? "UTC";

  // SSR: render both lines in venue TZ for a deterministic first
  // paint. Client: swap the "your time" line to the user's resolved
  // TZ via `Intl`. Layout (two lines) is identical pre/post hydration.
  const [userTz, setUserTz] = useState<string>(venueTz);
  const [hydrated, setHydrated] = useState<boolean>(false);
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || venueTz;
      setUserTz(tz);
    } catch {
      // ignore; venue TZ stays as the user TZ
    }
    setHydrated(true);
  }, [venueTz]);

  const d = new Date(kickoffUtc);
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: userTz,
  }).format(d);
  const userTime = splitTimeAndZone(d, userTz);
  const venueTime = splitTimeAndZone(d, venueTz);

  // Same-zone collapse: only meaningful after hydration, so the
  // server still emits the two-line shape.
  const sameZone = hydrated && userTz === venueTz;

  return (
    <section className="vt-match-overlay-when" aria-label="Kickoff time">
      <div className="vt-match-overlay-when-date">{dateLabel}</div>
      <div className="vt-match-overlay-when-row vt-match-overlay-when-primary">
        <span className="vt-match-overlay-when-time">{userTime.time}</span>
        <span className="vt-match-overlay-when-tz">{userTime.zone}</span>
        <span className="vt-match-overlay-when-caption">
          {sameZone ? "kickoff" : "your time"}
        </span>
      </div>
      {!sameZone && (
        <div className="vt-match-overlay-when-row vt-match-overlay-when-secondary">
          <span className="vt-match-overlay-when-time">{venueTime.time}</span>
          <span className="vt-match-overlay-when-tz">{venueTime.zone}</span>
          <span className="vt-match-overlay-when-caption">local kickoff</span>
        </div>
      )}
    </section>
  );
}

/**
 * Split an Intl `timeZoneName: "short"` rendering into the bare
 * time ("08:00", "8:00 AM") and the zone label ("GMT+12", "CDT").
 * Used by the When block so the large primary line shows the time
 * at heading size and the zone label drops to caption size next to
 * it (per Tim 2026-06-06).
 */
function splitTimeAndZone(
  d: Date,
  timezone: string,
): { time: string; zone: string } {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(d);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    const timeOnly = parts
      .filter((p) => p.type !== "timeZoneName" && p.type !== "literal")
      .reduce<string>((acc, p, i, arr) => {
        // Re-emit literals between non-tz parts to keep colons and
        // AM/PM spacing intact ("8:00 AM" not "800AM").
        if (i === 0) return p.value;
        const prevLiteral = parts.find(
          (q, qi) =>
            qi > parts.indexOf(arr[i - 1]!) &&
            qi < parts.indexOf(p) &&
            q.type === "literal",
        );
        return acc + (prevLiteral?.value ?? "") + p.value;
      }, "")
      .trim();
    return { time: timeOnly || "-", zone: tzPart?.value ?? "" };
  } catch {
    return { time: "-", zone: "" };
  }
}

// ---------- Where block ----------

interface WhereBlockProps {
  readonly hostCity: HostCity;
}

function WhereBlock(props: WhereBlockProps) {
  const { hostCity } = props;
  const countryFlag = countryFlagEmoji(hostCity.country);
  const countryName = countryDisplayName(hostCity.country);
  const stadiumDiffers =
    hostCity.stadium_tournament_name !== hostCity.stadium;
  const capacityFormatted = new Intl.NumberFormat(undefined).format(
    hostCity.capacity,
  );

  return (
    <section className="vt-match-overlay-where" aria-label="Venue">
      <div className="vt-match-overlay-where-city">
        <span className="vt-match-overlay-where-flag" aria-hidden="true">
          {countryFlag}
        </span>
        <span>
          {hostCity.city}, {countryName}
        </span>
      </div>
      <div className="vt-match-overlay-where-stadium">{hostCity.stadium}</div>
      <div className="vt-match-overlay-where-meta">
        {stadiumDiffers && (
          <>
            Officially &ldquo;{hostCity.stadium_tournament_name}&rdquo;
            <span aria-hidden="true"> · </span>
          </>
        )}
        {capacityFormatted} seats
      </div>
    </section>
  );
}

// ---------- helpers ----------

function countryFlagEmoji(iso2: string): string {
  if (iso2.length !== 2) return "";
  const a = iso2.toUpperCase().charCodeAt(0);
  const b = iso2.toUpperCase().charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return "";
  return String.fromCodePoint(0x1f1e6 + (a - 65), 0x1f1e6 + (b - 65));
}

function countryDisplayName(iso2: string): string {
  try {
    return (
      new Intl.DisplayNames(undefined, { type: "region" }).of(
        iso2.toUpperCase(),
      ) ?? iso2
    );
  } catch {
    return iso2;
  }
}
