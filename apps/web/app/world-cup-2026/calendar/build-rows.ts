/**
 * Server-side row builder for the match calendar.
 *
 * Walks the enriched tournament's group fixtures + knockouts in
 * match-number order, resolves the home/away team codes for groups
 * (the team_ids are known from the Final Draw), and emits a flat
 * array of 104 rows. Knockout slot resolution is intentionally NOT
 * performed here, the cascade depends on user predictions; the
 * calendar page is a neutral schedule view, so unknown sides stay
 * as TBD with a description ("Pos 2, Group A", "Winner of R32 #01").
 */

import type {
  KnockoutFixture,
  Tournament,
} from "@tournamental/bracket-engine";

export type CalendarStage = "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";

export interface CalendarSide {
  /** Three-letter team code if known (group stages always known, knockouts never). */
  readonly code?: string;
  /** TBD descriptor for the unresolved knockout slot. */
  readonly slotLabel?: string;
}

export interface CalendarRow {
  readonly matchId: string;
  readonly matchNo: number;
  readonly stage: CalendarStage;
  /** "Group A · Match 2", "Round of 32 · #73". */
  readonly stageLabel: string;
  /** Short badge "GROUP A" or "R32 #73". */
  readonly stageBadge: string;
  readonly kickoffUtc: string;
  readonly venue: string;
  readonly host: string;
  readonly home: CalendarSide;
  readonly away: CalendarSide;
}

const STAGE_FULL: Record<Exclude<CalendarStage, "group">, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  tp: "Third-place playoff",
  f: "Final",
};

const STAGE_SHORT: Record<Exclude<CalendarStage, "group">, string> = {
  r32: "R32",
  r16: "R16",
  qf: "QF",
  sf: "SF",
  tp: "3RD",
  f: "FINAL",
};

function describeSlot(s: KnockoutFixture["home"] | KnockoutFixture["away"]): string {
  switch (s.kind) {
    case "group_position":
      return `Pos ${s.position}, Group ${s.group}`;
    case "best_third":
      return `Best 3rd #${s.rank}`;
    case "best_fourth":
      return `Best 4th #${s.rank}`;
    case "annex_c_third":
      return `Best 3rd (vs 1${s.group_winner})`;
    case "knockout_winner":
      return `Winner ${s.match_id.toUpperCase()}`;
    case "knockout_loser":
      return `Loser ${s.match_id.toUpperCase()}`;
  }
}

export function buildCalendarRows(tournament: Tournament): readonly CalendarRow[] {
  const rows: CalendarRow[] = [];

  // Group fixtures, 72 entries, match_no 1..72.
  for (const f of tournament.group_fixtures) {
    const grp = tournament.groups.find((g) => g.id === f.group_id);
    const homeCode = grp?.team_ids[f.home_idx];
    const awayCode = grp?.team_ids[f.away_idx];
    rows.push({
      matchId: String(f.match_no),
      matchNo: f.match_no,
      stage: "group",
      stageLabel: `Group ${f.group_id} · Match ${f.match_no}`,
      stageBadge: `GROUP ${f.group_id}`,
      kickoffUtc: f.kickoff_utc,
      venue: f.venue,
      host: f.host,
      home: { code: homeCode },
      away: { code: awayCode },
    });
  }

  // Knockouts, 32 entries, match_no 73..104.
  for (const ko of tournament.knockouts) {
    const stage = ko.stage as Exclude<CalendarStage, "group">;
    rows.push({
      matchId: ko.id,
      matchNo: ko.match_no,
      stage,
      stageLabel: `${STAGE_FULL[stage]} · Match ${ko.match_no}`,
      stageBadge: `${STAGE_SHORT[stage]} #${ko.match_no}`,
      kickoffUtc: ko.kickoff_utc,
      venue: ko.venue,
      host: ko.host,
      home: { slotLabel: describeSlot(ko.home) },
      away: { slotLabel: describeSlot(ko.away) },
    });
  }

  // Chronological order so the day-grouped calendar reads top-to-bottom by
  // date. Match numbers group by group (Group A's three matchdays span the
  // whole group stage before Group B starts), which would fragment the day
  // headers; kickoff order keeps one header per actual match day. Ties
  // (simultaneous kickoffs) fall back to match number for stable ordering.
  rows.sort((a, b) => {
    const ka = Date.parse(a.kickoffUtc);
    const kb = Date.parse(b.kickoffUtc);
    if (ka !== kb && !Number.isNaN(ka) && !Number.isNaN(kb)) return ka - kb;
    return a.matchNo - b.matchNo;
  });
  return rows;
}
