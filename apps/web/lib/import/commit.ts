/**
 * Reconcile a ParseResult to our canonical match ids + return a
 * PreviewResult the wizard can show, plus a `commit()` that applies
 * an approved preview to the user's bracket via the game-service
 * /v1/bracket/submit endpoint.
 *
 * Why we split preview from commit: the wizard shows the preview so
 * the user can confirm team-mappings are right (a "Korea" might map
 * KOR or PRK; we let them eyeball). The commit step then sends the
 * picks server-side, where the kickoff-backstop bypass (gated on
 * source='imported') lets retro picks through.
 */

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import {
  normaliseMatchTeams,
  normaliseTeamName,
  type TeamCode,
} from "./team-normalise";
import type {
  ImportSource,
  ParseResult,
  PreviewMatch,
  PreviewResult,
} from "./types";

// ---- Fixture index (built once at module scope) ---------------------

const FIXTURES = loadFixtures2026();
const NOW_MS = () => Date.now();

interface GroupMatchView {
  matchId: string;          // canonical, e.g. "1" .. "72"
  homeCode: TeamCode;
  awayCode: TeamCode;
  kickoffMs: number;
}

/**
 * Resolve every group-stage fixture into a {team-pair → matchId} index.
 * Key shape: "ARG-FRA" (alphabetical), value: the canonical match
 * info. Knockouts are not pre-indexed because their team pairs aren't
 * known until the group stage settles; for those the reconciler tries
 * to match by team-pair against the user's parsed picks but accepts
 * the fact that some won't resolve.
 */
function buildGroupIndex(): Map<string, GroupMatchView> {
  const idx = new Map<string, GroupMatchView>();
  // Tournament fixture shape: group.team_ids is a slot-ordered array
  // of TeamId; the GroupFixture references those slots by home_idx +
  // away_idx. The TeamId itself happens to be the ISO-3 / FIFA code we
  // use as our canonical TeamCode (see TeamId definition in
  // packages/bracket-engine/src/tournament.ts).
  for (const f of FIXTURES.group_fixtures) {
    const group = FIXTURES.groups.find((g) => g.id === f.group_id);
    if (!group) continue;
    const homeId = group.team_ids[f.home_idx];
    const awayId = group.team_ids[f.away_idx];
    if (!homeId || !awayId) continue;
    const homeCode = homeId as TeamCode;
    const awayCode = awayId as TeamCode;
    const key = teamPairKey(homeCode, awayCode);
    idx.set(key, {
      matchId: String(f.match_no),
      homeCode,
      awayCode,
      kickoffMs: Date.parse(f.kickoff_utc),
    });
  }
  return idx;
}

const GROUP_INDEX = buildGroupIndex();

function teamPairKey(a: TeamCode, b: TeamCode): string {
  return [a, b].sort().join("-");
}

// ---- Preview --------------------------------------------------------

export function buildPreview(args: {
  source: ImportSource;
  sourceUrl: string;
  parsed: ParseResult;
}): PreviewResult {
  const nowMs = NOW_MS();
  const matches: PreviewMatch[] = args.parsed.matches.map((raw) => {
    const normalised = normaliseMatchTeams({
      homeTeamRaw: raw.homeTeamRaw,
      awayTeamRaw: raw.awayTeamRaw,
      predictedWinnerRaw: raw.predictedWinnerRaw,
    });
    const warnings: string[] = [];
    if (!normalised) {
      const home = normaliseTeamName(raw.homeTeamRaw);
      const away = normaliseTeamName(raw.awayTeamRaw);
      if (!home) warnings.push(`Couldn't map "${raw.homeTeamRaw}" to a team code.`);
      if (!away) warnings.push(`Couldn't map "${raw.awayTeamRaw}" to a team code.`);
      if (home && away) {
        warnings.push(`Couldn't tell who you predicted to win (raw winner "${raw.predictedWinnerRaw}").`);
      }
      return {
        matchId: null,
        homeTeamCode: home,
        awayTeamCode: away,
        outcome: null,
        alreadyKickedOff: false,
        raw,
        warnings,
      };
    }
    // Reconcile to our matchId via the group index (group-stage only
    // for v1). Knockouts get a null matchId but we still surface the
    // pick in the preview so the user sees we read it.
    const key = teamPairKey(normalised.home, normalised.away);
    const fixture = GROUP_INDEX.get(key);
    const matchId = fixture?.matchId ?? null;
    const alreadyKickedOff = fixture ? fixture.kickoffMs <= nowMs : false;
    if (!matchId) {
      warnings.push("Knockout-stage picks are surfaced for review but not yet auto-saved (we wire knockout reconciliation in v1.1).");
    }
    return {
      matchId,
      homeTeamCode: normalised.home,
      awayTeamCode: normalised.away,
      outcome: normalised.outcome,
      alreadyKickedOff,
      raw,
      warnings,
    };
  });

  const champion = args.parsed.championRaw
    ? {
        code: normaliseTeamName(args.parsed.championRaw),
        raw: args.parsed.championRaw,
      }
    : null;
  const runnerUp = args.parsed.runnerUpRaw
    ? {
        code: normaliseTeamName(args.parsed.runnerUpRaw),
        raw: args.parsed.runnerUpRaw,
      }
    : null;

  const resolvable = matches.filter((m) => m.matchId !== null && m.outcome !== null).length;
  const alreadyLocked = matches.filter((m) => m.matchId !== null && m.alreadyKickedOff).length;
  const upcoming = matches.filter((m) => m.matchId !== null && !m.alreadyKickedOff).length;
  const unresolvable = matches.filter((m) => m.matchId === null || m.outcome === null).length;

  return {
    source: args.source,
    sourceUrl: args.sourceUrl,
    sourceUserHandle: args.parsed.sourceUserHandle,
    matches,
    champion,
    runnerUp,
    stats: {
      total: matches.length,
      resolvable,
      alreadyLocked,
      upcoming,
      unresolvable,
    },
  };
}

// ---- Commit ---------------------------------------------------------

/**
 * Convert a preview into the MatchPrediction shape the game-service
 * /v1/bracket/submit endpoint expects. Picks past kickoff carry
 * source='imported' so the server backstop bypass accepts them; picks
 * still upcoming also carry source='imported' so the audit + the
 * provenance survives (the user can later edit those normally and
 * the edit overwrites source back to 'live').
 *
 * Returns only resolvable rows (matchId + outcome both present); the
 * unresolvable rows surface in the preview as warnings and are skipped
 * at commit time.
 */
export function previewToMatchPredictions(preview: PreviewResult): Array<{
  matchId: string;
  outcome: "home_win" | "draw" | "away_win";
  lockedAt: string;
  source: "imported";
  originalLockedAt?: string;
}> {
  const nowIso = new Date().toISOString();
  const out: Array<{
    matchId: string;
    outcome: "home_win" | "draw" | "away_win";
    lockedAt: string;
    source: "imported";
    originalLockedAt?: string;
  }> = [];
  for (const m of preview.matches) {
    if (!m.matchId || !m.outcome) continue;
    out.push({
      matchId: m.matchId,
      outcome: m.outcome,
      // lockedAt is our usual "when did this enter our system" stamp.
      // The originalLockedAt carries the source's belief about when
      // the user actually committed the pick on the rival platform.
      lockedAt: nowIso,
      source: "imported",
      originalLockedAt: m.raw.sourceTimestamp,
    });
  }
  return out;
}
