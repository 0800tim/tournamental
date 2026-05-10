/**
 * Head-to-head W/D/L counts for the bracket row.
 *
 * Reads the same stub as the `/match/[id]/preview` route does — the file at
 * `apps/web/data/head-to-head.json`, keyed by alpha-sorted `${a}-${b}`,
 * with each entry being a list of historical meetings (date, scores,
 * competition). The bracket row only needs the rolled-up W/D/L counts so
 * we tally them here once at module load and look up by pair from the
 * derived map.
 *
 * For pairs not yet curated we fall back to a deterministic synth (FNV-1a
 * over the alpha-sorted pair key) so the H2H pill keeps its rhythm
 * everywhere — three small ints in 0..3 that sum to a plausible record.
 *
 * Pure, synchronous, no I/O.
 *
 * TODO(live-data): replace the underlying stub with FBref / SofaScore /
 * Wikipedia historical-meeting tables and drop the synth branch.
 */

import h2hRaw from "../data/head-to-head.json";

interface RawMeeting {
  readonly date: string;
  readonly homeCode: string;
  readonly awayCode: string;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly competition: string;
  readonly venue?: string;
  readonly extraTime?: boolean;
  readonly penalties?: string;
}

interface H2HFile {
  readonly pairs: Record<string, RawMeeting[]>;
}

const PAIRS: Record<string, RawMeeting[]> = (h2hRaw as unknown as H2HFile).pairs;

export interface HeadToHeadCounts {
  readonly homeWins: number;
  readonly draws: number;
  readonly awayWins: number;
}

function pairKey(a: string, b: string): string {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  return [A, B].sort().join("-");
}

/**
 * Look up the head-to-head W/D/L counts between `homeCode` and `awayCode`.
 * Returns null only when the input itself is invalid (same team, missing
 * code). Otherwise always returns counts (curated or synthesised).
 */
export function headToHeadFor(
  homeCode: string,
  awayCode: string,
): HeadToHeadCounts | null {
  if (!homeCode || !awayCode || homeCode === awayCode) return null;
  const a = homeCode.toUpperCase();
  const b = awayCode.toUpperCase();
  const meetings = PAIRS[pairKey(a, b)];
  if (meetings && meetings.length > 0) {
    return tallyMeetings(a, b, meetings);
  }
  return synthesiseFallback(a, b);
}

function tallyMeetings(
  homeCode: string,
  awayCode: string,
  meetings: readonly RawMeeting[],
): HeadToHeadCounts {
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  for (const m of meetings) {
    if (m.homeScore === m.awayScore) {
      draws += 1;
      continue;
    }
    const winnerCode = m.homeScore > m.awayScore ? m.homeCode : m.awayCode;
    if (winnerCode === homeCode) homeWins += 1;
    else if (winnerCode === awayCode) awayWins += 1;
  }
  return { homeWins, draws, awayWins };
}

function synthesiseFallback(
  homeCode: string,
  awayCode: string,
): HeadToHeadCounts {
  const key = pairKey(homeCode, awayCode);
  // FNV-1a 32-bit; cheap and stable across reloads.
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // The hash is alpha-sorted-pair derived, so to keep results stable
  // regardless of which side the caller passed as "home", we slot the
  // counts onto whichever code sorted first.
  const first = (h >>> 0) % 4;
  const draws = ((h >>> 8) >>> 0) % 4;
  const second = ((h >>> 16) >>> 0) % 4;
  const reversed = homeCode.toUpperCase() > awayCode.toUpperCase();
  return reversed
    ? { homeWins: second, draws, awayWins: first }
    : { homeWins: first, draws, awayWins: second };
}
