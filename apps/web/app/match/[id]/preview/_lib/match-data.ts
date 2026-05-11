/**
 * Pure helpers for `/match/[id]/preview`.
 *
 *   - resolveMatch(id), find a match by id (group fixture `match_no`
 *     stringified, or knockout `id` like `r32_01`/`final`); returns
 *     home / away team codes when known plus stage label and kickoff.
 *   - headToHead(homeCode, awayCode), last <=5 historical meetings
 *     from `apps/web/data/head-to-head.json`. The pair lookup is
 *     direction-insensitive: ARG-FRA finds the same record as FRA-ARG
 *     and per-meeting `homeCode` / `awayCode` are preserved.
 *   - lineupFor(code), predicted XI from `team-formations.json`,
 *     or a synthesised 4-3-3 from the team's squad in
 *     `team-squads.json` if the formations file has no entry.
 *   - statsFor(code), pre-match expected stats from
 *     `team-stats.json`, or a deterministic synthesised default
 *     derived from the team's FIFA rank.
 *
 * All loaders are synchronous + pure so they're safe to call from a
 * server component.
 *
 * TODO(live-data):
 *   - replace `head-to-head.json` with FBref / SofaScore / Wikipedia
 *     historical meeting tables.
 *   - replace `team-formations.json` with FBref's predicted-XI scrape
 *     or SofaScore's `lineups` endpoint.
 *   - replace `team-stats.json` with FBref season-aggregate metrics or
 *     an internal pre-match xG model.
 */

import type {
  GroupFixture,
  KnockoutFixture,
  Tournament,
  CascadedKnockout,
} from "@tournamental/bracket-engine";
import { cascade, type BracketPrediction } from "@tournamental/bracket-engine";

import canonicalFixturesRaw from "../../../../../../../data/fifa-wc-2026/fixtures.json";
import canonicalTeamsRaw from "../../../../../../../data/fifa-wc-2026/teams.json";
import h2hRaw from "../../../../../data/head-to-head.json";
import formationsRaw from "../../../../../data/team-formations.json";
import statsRaw from "../../../../../data/team-stats.json";
import squadsRaw from "../../../../../data/team-squads.json";

// ---------- canonical type plumbing (mirrors the team-detail loader) ----------

interface CanonicalTeam {
  readonly code: string;
  readonly name: string;
  readonly short_name: string;
  readonly fifa_ranking_at_2026: number;
  readonly flag_emoji?: string;
  readonly kit?: { readonly primary?: string; readonly secondary?: string };
}

interface CanonicalFixture {
  readonly match_number: number;
  readonly stage: string;
  readonly home_team_slot: string;
  readonly away_team_slot: string;
  readonly host_city_id?: string;
  readonly kickoff_utc: string;
  readonly venue?: string;
}

const CANONICAL_TEAMS = (canonicalTeamsRaw as { teams: CanonicalTeam[] }).teams;
const CANONICAL_FIXTURES = (canonicalFixturesRaw as { fixtures: CanonicalFixture[] }).fixtures;

const CANONICAL_BY_CODE = new Map<string, CanonicalTeam>(
  CANONICAL_TEAMS.map((t) => [t.code, t]),
);

export function canonicalTeam(code: string): CanonicalTeam | undefined {
  return CANONICAL_BY_CODE.get(code.toUpperCase());
}

// ---------- match resolution ----------

export interface ResolvedMatch {
  /** The id we accept in the URL: group `match_no` stringified, or
   * knockout id (`r32_01`, `final`, `tp_01`, ...). */
  readonly matchId: string;
  /** "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f". */
  readonly stage: "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";
  /** Display label for the round/group, e.g. "Group D" or "Round of 32". */
  readonly stageLabel: string;
  /** Home team code if known, else undefined (knockout slot not yet
   * resolved by the cascade). */
  readonly homeCode?: string;
  /** Away team code if known. */
  readonly awayCode?: string;
  /** Slot description for an unknown side, e.g. "Winner of R32 #03". */
  readonly homeSlotLabel?: string;
  readonly awaySlotLabel?: string;
  readonly kickoffUtc: string;
  readonly venue?: string;
  /** Original group_id for group matches ("A".."L"). */
  readonly groupId?: string;
  /** Match number (1..104), useful for the share URL and OG image. */
  readonly matchNo: number;
}

const STAGE_LABELS: Record<string, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  tp: "Third-place playoff",
  f: "Final",
};

function describeSlot(s: KnockoutFixture["home"] | KnockoutFixture["away"]): string {
  switch (s.kind) {
    case "group_position":
      return `Position ${s.position}, Group ${s.group}`;
    case "best_third":
      return `Best 3rd #${s.rank}`;
    case "best_fourth":
      return `Best 4th #${s.rank}`;
    case "knockout_winner":
      return `Winner of ${s.match_id.toUpperCase()}`;
    case "knockout_loser":
      return `Loser of ${s.match_id.toUpperCase()}`;
  }
}

/**
 * Build an empty cascade so knockouts that depend purely on placeholder
 * group positions resolve to "TBD". The empty bracket has no
 * predictions, so cascade returns the placeholder structure unchanged
 * and we use it just to label slots consistently.
 */
function emptyBracketPrediction(tournament: Tournament): BracketPrediction {
  return {
    tournament_id: tournament.id,
    user_id: "preview",
    groups: [],
    best_thirds: [],
    best_fourths: [],
    knockouts: [],
    locks: [],
    updated_at_utc: new Date(0).toISOString(),
  };
}

export function resolveMatch(
  tournament: Tournament,
  rawId: string,
): ResolvedMatch | null {
  const id = rawId.trim();

  // 1. Group fixture? Try parsing as integer match_no.
  const asNum = Number.parseInt(id, 10);
  if (Number.isFinite(asNum) && /^\d+$/.test(id)) {
    const f = tournament.group_fixtures.find((x) => x.match_no === asNum);
    if (f) return resolveGroupFixture(tournament, f);
    // Could also be a knockout match_no (73-104) since the canonical
    // fixtures.json keys knockouts by sequential match_number too.
    const ko = tournament.knockouts.find((x) => x.match_no === asNum);
    if (ko) return resolveKnockoutFixture(tournament, ko);
  }

  // 2. Knockout id? "r32_01", "qf_03", "final", "tp_01".
  const ko = tournament.knockouts.find((x) => x.id === id);
  if (ko) return resolveKnockoutFixture(tournament, ko);

  return null;
}

function resolveGroupFixture(
  tournament: Tournament,
  f: GroupFixture,
): ResolvedMatch {
  const grp = tournament.groups.find((g) => g.id === f.group_id);
  const homeCode = grp?.team_ids[f.home_idx];
  const awayCode = grp?.team_ids[f.away_idx];
  return {
    matchId: String(f.match_no),
    matchNo: f.match_no,
    stage: "group",
    stageLabel: `Group ${f.group_id}`,
    groupId: f.group_id,
    homeCode,
    awayCode,
    kickoffUtc: f.kickoff_utc,
    venue: f.venue,
  };
}

function resolveKnockoutFixture(
  tournament: Tournament,
  ko: KnockoutFixture,
): ResolvedMatch {
  // Walk the empty cascade to pick up any slot occupant we can resolve
  // without picks (currently always "TBD" until users predict). Still
  // run it so future engine improvements (e.g. a pre-seeded bracket
  // for marketing) Just Work.
  const cascaded = cascade(tournament, emptyBracketPrediction(tournament));
  const c = cascaded.knockouts.find((k) => k.id === ko.id) as
    | CascadedKnockout
    | undefined;

  const homeCode = c?.home.team ?? undefined;
  const awayCode = c?.away.team ?? undefined;
  const stageKey = ko.stage as ResolvedMatch["stage"];

  return {
    matchId: ko.id,
    matchNo: ko.match_no,
    stage: stageKey,
    stageLabel: STAGE_LABELS[stageKey] ?? stageKey.toUpperCase(),
    homeCode,
    awayCode,
    homeSlotLabel: homeCode ? undefined : describeSlot(ko.home),
    awaySlotLabel: awayCode ? undefined : describeSlot(ko.away),
    kickoffUtc: ko.kickoff_utc,
    venue: ko.venue,
  };
}

// ---------- head-to-head ----------

export interface H2HMeeting {
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

export interface H2HRecord {
  readonly meetings: readonly H2HMeeting[];
  readonly homeWins: number;
  readonly awayWins: number;
  readonly draws: number;
  readonly stub: boolean;
}

const H2H_PAIRS = (h2hRaw as { pairs: Record<string, H2HMeeting[]> }).pairs;

/**
 * Direction-insensitive lookup. The JSON only stores one orientation
 * per pair (alphabetical) but `homeCode`/`awayCode` per meeting are
 * preserved so the row reads correctly regardless of the order the
 * caller asks in.
 */
export function headToHead(homeCode: string, awayCode: string): H2HRecord {
  const a = homeCode.toUpperCase();
  const b = awayCode.toUpperCase();
  const key = [a, b].sort().join("-");
  const meetings = H2H_PAIRS[key] ?? [];

  if (meetings.length === 0) {
    // Synthesise a deterministic stub so the page is testable for any
    // pair. Hash the codes into a 1-3 result count.
    const stub = synthesiseH2H(a, b);
    return stub;
  }

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  for (const m of meetings) {
    if (m.homeScore === m.awayScore) {
      draws += 1;
    } else {
      const homeWonThisMatch = m.homeScore > m.awayScore;
      const winnerCode = homeWonThisMatch ? m.homeCode : m.awayCode;
      if (winnerCode === a) homeWins += 1;
      else if (winnerCode === b) awayWins += 1;
    }
  }
  return { meetings, homeWins, awayWins, draws, stub: false };
}

/**
 * Stable seeded hash (FNV-1a 32-bit) so the same pair always renders
 * the same fake record. Important: same answer regardless of the
 * order the caller passes the codes in, so we sort first.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function synthesiseH2H(a: string, b: string): H2HRecord {
  const seed = fnv1a([a, b].sort().join("-"));
  const total = (seed % 4) + 2; // 2..5 historical meetings
  const meetings: H2HMeeting[] = [];
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  for (let i = 0; i < total; i += 1) {
    const r = ((seed >>> ((i * 5) % 24)) ^ (i * 2654435761)) >>> 0;
    const homeFirst = (r & 1) === 1;
    const homeCode = homeFirst ? a : b;
    const awayCode = homeFirst ? b : a;
    const homeScore = (r >>> 4) % 4;
    const awayScore = (r >>> 8) % 4;
    if (homeScore === awayScore) draws += 1;
    else if ((homeScore > awayScore ? homeCode : awayCode) === a) homeWins += 1;
    else awayWins += 1;
    const yearSeed = 2024 - i * 2 - ((r >>> 12) & 1);
    meetings.push({
      date: `${yearSeed}-${String(((r >>> 16) % 12) + 1).padStart(2, "0")}-${String(((r >>> 20) % 28) + 1).padStart(2, "0")}`,
      homeCode,
      awayCode,
      homeScore,
      awayScore,
      competition: pickCompetition(r),
      venue: pickVenue(r),
    });
  }
  return { meetings, homeWins, awayWins, draws, stub: true };
}

function pickCompetition(r: number): string {
  const n = (r >>> 24) % 4;
  return ["Friendly", "WC Qualifier", "Confederations Cup", "Nations League"][n]!;
}
function pickVenue(r: number): string {
  const n = (r >>> 28) % 4;
  return ["Neutral ground", "Home venue", "Away venue", "Wembley, London"][n]!;
}

// ---------- lineups / formations ----------

export interface FormationPlayer {
  readonly jersey: number;
  readonly name: string;
  readonly position: string;
  readonly x: number;
  readonly y: number;
}

export interface TeamFormation {
  readonly formation: string;
  readonly xi: readonly FormationPlayer[];
  readonly stub: boolean;
}

interface SquadPlayer {
  readonly jersey: number;
  readonly name: string;
  readonly position: "GK" | "DF" | "MF" | "FW";
  readonly captain?: boolean;
}

const FORMATIONS = (
  formationsRaw as {
    teams: Record<string, { formation: string; xi: FormationPlayer[] }>;
  }
).teams;
const SQUADS = (squadsRaw as { teams: Record<string, SquadPlayer[]> }).teams;

/**
 * 4-3-3 default x/y positions on a 100x100 normalised pitch. The
 * synthesiser lays out: GK (back), back-4 (CB pair + FBs), midfield
 * trio, then front-3.
 */
const DEFAULT_433: ReadonlyArray<{ x: number; y: number; pos: string }> = [
  { x: 5,  y: 50, pos: "GK" },
  { x: 25, y: 85, pos: "RB" },
  { x: 22, y: 65, pos: "CB" },
  { x: 22, y: 35, pos: "CB" },
  { x: 25, y: 15, pos: "LB" },
  { x: 50, y: 70, pos: "CM" },
  { x: 50, y: 50, pos: "CM" },
  { x: 50, y: 30, pos: "CM" },
  { x: 80, y: 80, pos: "RW" },
  { x: 85, y: 50, pos: "ST" },
  { x: 80, y: 20, pos: "LW" },
];

export function lineupFor(code: string): TeamFormation {
  const upper = code.toUpperCase();
  const direct = FORMATIONS[upper];
  if (direct) return { ...direct, stub: false };
  return synthesiseLineup(upper);
}

function synthesiseLineup(code: string): TeamFormation {
  const squad = SQUADS[code] ?? [];
  // Sort by position priority (GK first, then DF, MF, FW), keep
  // jersey order within each band, gives a stable "starter" set.
  const order: Record<SquadPlayer["position"], number> = {
    GK: 0,
    DF: 1,
    MF: 2,
    FW: 3,
  };
  const sorted = [...squad].sort((a, b) => {
    const oa = order[a.position] - order[b.position];
    if (oa !== 0) return oa;
    return a.jersey - b.jersey;
  });

  const xi: FormationPlayer[] = DEFAULT_433.map((slot, i) => {
    const player = sorted[i];
    return {
      jersey: player?.jersey ?? i + 1,
      name: player?.name ?? `${code} ${i + 1}`,
      position: slot.pos,
      x: slot.x,
      y: slot.y,
    };
  });
  return { formation: "4-3-3", xi, stub: true };
}

// ---------- expected match stats ----------

export interface TeamStats {
  readonly xg_per_match: number;
  readonly xga_per_match: number;
  readonly possession_pct: number;
  readonly shots_per_match: number;
  readonly shots_on_target_per_match: number;
  readonly pass_accuracy_pct: number;
  readonly form_rating: number;
  readonly stub: boolean;
}

const STATS = (statsRaw as { teams: Record<string, Omit<TeamStats, "stub">> }).teams;

export function statsFor(code: string): TeamStats {
  const upper = code.toUpperCase();
  const direct = STATS[upper];
  if (direct) return { ...direct, stub: false };
  return synthesiseStats(upper);
}

function synthesiseStats(code: string): TeamStats {
  const t = canonicalTeam(code);
  const fifa = t?.fifa_ranking_at_2026 ?? 100;
  // Lower-rank → better numbers. Cap at sensible bounds.
  const skill = Math.max(0, 1 - fifa / 211); // 0..1
  return {
    xg_per_match: round1(0.7 + skill * 1.5),
    xga_per_match: round1(1.6 - skill * 1.0),
    possession_pct: Math.round(40 + skill * 25),
    shots_per_match: round1(8 + skill * 8),
    shots_on_target_per_match: round1(2.5 + skill * 3.5),
    pass_accuracy_pct: Math.round(74 + skill * 16),
    form_rating: round1(5.5 + skill * 2.5),
    stub: true,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Pre-match expected scoreline. Naive blend of home xG vs away xGA,
 * and vice versa, with a small home advantage. Used by the Stats tab.
 */
export interface ExpectedScoreline {
  readonly homeXg: number;
  readonly awayXg: number;
  readonly homePossession: number;
  readonly awayPossession: number;
  readonly homeShots: number;
  readonly awayShots: number;
}

export function expectedScoreline(homeCode: string, awayCode: string): ExpectedScoreline {
  const h = statsFor(homeCode);
  const a = statsFor(awayCode);
  const homeXg = round1((h.xg_per_match + a.xga_per_match) / 2 * 1.05);
  const awayXg = round1((a.xg_per_match + h.xga_per_match) / 2);
  const totalPoss = h.possession_pct + a.possession_pct;
  const homePossession = Math.round((h.possession_pct / totalPoss) * 100);
  const awayPossession = 100 - homePossession;
  const homeShots = round1((h.shots_per_match + a.shots_per_match) / 2 * 1.04);
  const awayShots = round1((a.shots_per_match + h.shots_per_match) / 2);
  return {
    homeXg,
    awayXg,
    homePossession,
    awayPossession,
    homeShots,
    awayShots,
  };
}

// ---------- canonical fixtures convenience ----------

export function canonicalFixtureByMatchNumber(matchNo: number): CanonicalFixture | undefined {
  return CANONICAL_FIXTURES.find((f) => f.match_number === matchNo);
}
