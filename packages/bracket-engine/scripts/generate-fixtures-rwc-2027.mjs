#!/usr/bin/env node
/**
 * Generate `data/rwc-2027-fixtures.json` for the Men's Rugby World Cup
 * 2027 (Australia, 1 October to 13 November 2027). Deterministic output:
 * running this twice produces identical bytes.
 *
 * Source: the pools, dates, local kickoff times and venues published by
 * World Rugby, transcribed from the English Wikipedia tournament and pool
 * pages and then checked match by match (date, UTC kickoff, venue, slot
 * labels) against the official list at rugbyworldcup.com/2027/en/matches
 * on 2026-10-21. The round of 16 third-place permutation table is the
 * tournament page's table, checked in the test suite against the
 * bracket constraints (1A meets a third from C/E/F, 1B from D/E/F, 1C
 * from A/E/F, 1D from B/E/F).
 *
 * Kickoffs are stored in UTC. Local times carry the zone the source
 * gives per match (AWST +8, AEST +10, AEDT +11, ACST +9:30, ACDT +10:30;
 * daylight time starts in NSW, Victoria and SA on 3 October 2027).
 *
 * Run with:  node scripts/generate-fixtures-rwc-2027.mjs
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "data", "rwc-2027-fixtures.json");

// ---------- teams ----------
// Ids follow the repo convention (FIFA-style trigrams shared with the
// flag assets) with IRE for the all-island Ireland union. `world_rank`
// is the World Rugby ranking of 1 December 2025 used for the draw
// bands; `pre_tournament_implied_win` is a rough estimate to replace
// with market odds before picks open.
const TEAMS = [
  // Pool A
  ["NZL", "New Zealand", 2, 0.2],
  ["AUS", "Australia", 7, 0.07],
  ["CHI", "Chile", 17, 0.001],
  ["HKG", "Hong Kong China", 23, 0.0005],
  // Pool B
  ["RSA", "South Africa", 1, 0.22],
  ["ITA", "Italy", 10, 0.015],
  ["GEO", "Georgia", 13, 0.005],
  ["ROU", "Romania", 22, 0.001],
  // Pool C
  ["ARG", "Argentina", 6, 0.06],
  ["FIJ", "Fiji", 8, 0.02],
  ["ESP", "Spain", 15, 0.002],
  ["CAN", "Canada", 21, 0.001],
  // Pool D
  ["IRE", "Ireland", 4, 0.11],
  ["SCO", "Scotland", 9, 0.03],
  ["URU", "Uruguay", 14, 0.003],
  ["POR", "Portugal", 20, 0.002],
  // Pool E
  ["FRA", "France", 5, 0.11],
  ["JPN", "Japan", 12, 0.01],
  ["USA", "United States", 16, 0.003],
  ["SAM", "Samoa", 19, 0.003],
  // Pool F
  ["ENG", "England", 3, 0.09],
  ["WAL", "Wales", 11, 0.015],
  ["TGA", "Tonga", 18, 0.003],
  ["ZIM", "Zimbabwe", 24, 0.0005],
];

const POOLS = {
  A: ["NZL", "AUS", "CHI", "HKG"],
  B: ["RSA", "ITA", "GEO", "ROU"],
  C: ["ARG", "FIJ", "ESP", "CAN"],
  D: ["IRE", "SCO", "URU", "POR"],
  E: ["FRA", "JPN", "USA", "SAM"],
  F: ["ENG", "WAL", "TGA", "ZIM"],
};

const VENUES = {
  PER: "Perth Stadium, Perth",
  SYD: "Stadium Australia, Sydney",
  SFS: "Sydney Football Stadium, Sydney",
  TSV: "North Queensland Stadium, Townsville",
  MEL: "Docklands Stadium, Melbourne",
  BNE: "Brisbane Stadium, Brisbane",
  ADL: "Adelaide Oval, Adelaide",
  NTL: "Newcastle Stadium, Newcastle",
};

// [pool, local date, local time, UTC offset, home, away, venue]
const POOL_MATCHES = [
  ["A", "2027-10-01", "18:45", "+08:00", "AUS", "HKG", "PER"],
  ["A", "2027-10-02", "13:15", "+08:00", "NZL", "CHI", "PER"],
  ["A", "2027-10-09", "17:10", "+11:00", "NZL", "AUS", "SYD"],
  ["A", "2027-10-09", "20:15", "+10:00", "CHI", "HKG", "TSV"],
  ["A", "2027-10-15", "17:15", "+11:00", "NZL", "HKG", "MEL"],
  ["A", "2027-10-16", "15:10", "+10:00", "AUS", "CHI", "BNE"],
  ["B", "2027-10-03", "14:15", "+10:30", "RSA", "ITA", "ADL"],
  ["B", "2027-10-03", "20:15", "+10:00", "GEO", "ROU", "TSV"],
  ["B", "2027-10-10", "16:45", "+10:00", "RSA", "GEO", "BNE"],
  ["B", "2027-10-11", "19:45", "+11:00", "ITA", "ROU", "SFS"],
  ["B", "2027-10-17", "12:15", "+11:00", "ITA", "GEO", "NTL"],
  ["B", "2027-10-17", "19:15", "+08:00", "RSA", "ROU", "PER"],
  ["C", "2027-10-04", "14:15", "+11:00", "FIJ", "ESP", "NTL"],
  ["C", "2027-10-04", "18:45", "+10:00", "ARG", "CAN", "BNE"],
  ["C", "2027-10-10", "12:15", "+10:30", "FIJ", "CAN", "ADL"],
  ["C", "2027-10-10", "15:15", "+11:00", "ARG", "ESP", "MEL"],
  ["C", "2027-10-16", "13:15", "+10:30", "ARG", "FIJ", "ADL"],
  ["C", "2027-10-16", "20:15", "+10:00", "ESP", "CAN", "TSV"],
  ["D", "2027-10-03", "17:15", "+11:00", "SCO", "URU", "MEL"],
  ["D", "2027-10-04", "17:15", "+11:00", "IRE", "POR", "SFS"],
  ["D", "2027-10-10", "17:45", "+08:00", "IRE", "SCO", "PER"],
  ["D", "2027-10-11", "17:15", "+11:00", "URU", "POR", "NTL"],
  ["D", "2027-10-17", "14:45", "+11:00", "IRE", "URU", "MEL"],
  ["D", "2027-10-17", "16:15", "+10:00", "SCO", "POR", "BNE"],
  ["E", "2027-10-02", "17:45", "+10:00", "FRA", "USA", "MEL"],
  ["E", "2027-10-03", "12:15", "+11:00", "JPN", "SAM", "NTL"],
  ["E", "2027-10-09", "12:15", "+08:00", "USA", "SAM", "PER"],
  ["E", "2027-10-09", "18:45", "+10:00", "FRA", "JPN", "BNE"],
  ["E", "2027-10-15", "20:00", "+10:30", "JPN", "USA", "ADL"],
  ["E", "2027-10-17", "19:45", "+11:00", "FRA", "SAM", "SFS"],
  ["F", "2027-10-02", "12:15", "+09:30", "WAL", "ZIM", "ADL"],
  ["F", "2027-10-02", "20:15", "+10:00", "ENG", "TGA", "BNE"],
  ["F", "2027-10-08", "18:15", "+11:00", "WAL", "TGA", "MEL"],
  ["F", "2027-10-08", "20:15", "+10:30", "ENG", "ZIM", "ADL"],
  ["F", "2027-10-15", "20:15", "+10:00", "TGA", "ZIM", "TSV"],
  ["F", "2027-10-16", "19:45", "+11:00", "ENG", "WAL", "SYD"],
];

const gp = (group, position) => ({ kind: "group_position", group, position });
const third = (group_winner) => ({ kind: "annex_c_third", group_winner });
const winner = (match_id) => ({ kind: "knockout_winner", match_id });
const loser = (match_id) => ({ kind: "knockout_loser", match_id });

// [id, stage, local date, local time, UTC offset, home slot, away slot, venue]
// Round of 16 ids follow the published order (chronological); the
// quarter-final pairings are the published bracket.
const KNOCKOUTS = [
  ["r16_01", "r16", "2027-10-23", "14:15", "+11:00", gp("C", 2), gp("F", 2), "SFS"],
  ["r16_02", "r16", "2027-10-23", "15:45", "+10:00", gp("A", 1), third("A"), "BNE"],
  ["r16_03", "r16", "2027-10-23", "19:15", "+11:00", gp("E", 1), gp("D", 2), "MEL"],
  ["r16_04", "r16", "2027-10-23", "18:45", "+08:00", gp("B", 1), third("B"), "PER"],
  ["r16_05", "r16", "2027-10-24", "14:15", "+11:00", gp("C", 1), third("C"), "SFS"],
  ["r16_06", "r16", "2027-10-24", "16:45", "+11:00", gp("D", 1), third("D"), "MEL"],
  ["r16_07", "r16", "2027-10-24", "18:15", "+10:00", gp("A", 2), gp("E", 2), "BNE"],
  ["r16_08", "r16", "2027-10-24", "18:45", "+08:00", gp("F", 1), gp("B", 2), "PER"],
  ["qf_01", "qf", "2027-10-30", "16:45", "+11:00", winner("r16_02"), winner("r16_04"), "SYD"],
  ["qf_02", "qf", "2027-10-30", "18:45", "+10:00", winner("r16_01"), winner("r16_03"), "BNE"],
  ["qf_03", "qf", "2027-10-31", "16:00", "+10:00", winner("r16_05"), winner("r16_06"), "BNE"],
  ["qf_04", "qf", "2027-10-31", "20:00", "+11:00", winner("r16_07"), winner("r16_08"), "SYD"],
  ["sf_01", "sf", "2027-11-05", "20:00", "+11:00", winner("qf_01"), winner("qf_02"), "SYD"],
  ["sf_02", "sf", "2027-11-06", "20:00", "+11:00", winner("qf_03"), winner("qf_04"), "SYD"],
  ["tp_01", "tp", "2027-11-12", "19:45", "+11:00", loser("sf_01"), loser("sf_02"), "SYD"],
  ["final", "f", "2027-11-13", "20:00", "+11:00", winner("sf_01"), winner("sf_02"), "SYD"],
];

// Round of 16 third-place permutations: which pool's third-placed team
// meets each pool winner, by the set of four pools whose thirds qualify.
const R16_THIRDS = {
  "A,B,C,D": { "1A": "C", "1B": "D", "1C": "A", "1D": "B" },
  "A,B,C,E": { "1A": "C", "1B": "E", "1C": "A", "1D": "B" },
  "A,B,C,F": { "1A": "C", "1B": "F", "1C": "A", "1D": "B" },
  "A,B,D,E": { "1A": "E", "1B": "D", "1C": "A", "1D": "B" },
  "A,B,D,F": { "1A": "F", "1B": "D", "1C": "A", "1D": "B" },
  "A,B,E,F": { "1A": "E", "1B": "F", "1C": "A", "1D": "B" },
  "A,C,D,E": { "1A": "C", "1B": "D", "1C": "A", "1D": "E" },
  "A,C,D,F": { "1A": "C", "1B": "D", "1C": "A", "1D": "F" },
  "A,C,E,F": { "1A": "C", "1B": "E", "1C": "A", "1D": "F" },
  "A,D,E,F": { "1A": "E", "1B": "D", "1C": "A", "1D": "F" },
  "B,C,D,E": { "1A": "C", "1B": "D", "1C": "E", "1D": "B" },
  "B,C,D,F": { "1A": "C", "1B": "D", "1C": "F", "1D": "B" },
  "B,C,E,F": { "1A": "C", "1B": "E", "1C": "F", "1D": "B" },
  "B,D,E,F": { "1A": "E", "1B": "D", "1C": "F", "1D": "B" },
  "C,D,E,F": { "1A": "C", "1B": "D", "1C": "E", "1D": "F" },
};

function utc(date, time, offset) {
  return new Date(`${date}T${time}:00${offset}`).toISOString().replace(".000Z", "Z");
}

const teams = TEAMS.map(([id, name, world_rank, pre_tournament_implied_win]) => ({
  id,
  name,
  country: id,
  fifa_rank: world_rank,
  world_rank,
  ranked_at: "2025-12-01",
  pre_tournament_implied_win,
  placeholder: false,
}));

const groups = Object.entries(POOLS).map(([id, team_ids]) => ({ id, team_ids }));

const poolFixtures = POOL_MATCHES.map(([group_id, date, time, offset, home, away, venue]) => ({
  group_id,
  home_idx: POOLS[group_id].indexOf(home),
  away_idx: POOLS[group_id].indexOf(away),
  kickoff_utc: utc(date, time, offset),
  host: "AU",
  venue: VENUES[venue],
}));
poolFixtures.sort((a, b) => (a.kickoff_utc < b.kickoff_utc ? -1 : a.kickoff_utc > b.kickoff_utc ? 1 : a.venue.localeCompare(b.venue)));
const group_fixtures = poolFixtures.map((f, i) => ({ match_no: i + 1, ...f }));

const knockouts = KNOCKOUTS.map(([id, stage, date, time, offset, home, away, venue], i) => ({
  id,
  stage,
  match_no: group_fixtures.length + i + 1,
  home,
  away,
  kickoff_utc: utc(date, time, offset),
  host: "AU",
  venue: VENUES[venue],
}));

const tournament = {
  _meta: {
    source:
      "World Rugby's published RWC 2027 pools, schedule and round of 16 permutations: transcribed from the English Wikipedia tournament and pool pages, then every match checked against the official match list (read 2026-10-21)",
    source_url: "https://www.rugbyworldcup.com/2027/en/matches",
    schedule_status: "official",
    fetched_at_utc: "2026-10-21T00:00:00Z",
    notes:
      "24 teams, 6 pools of 4, 36 pool matches, round of 16 (top two per pool plus the four best thirds), quarter-finals, semi-finals, bronze final and final: 52 matches. Match numbers are chronological by UTC kickoff (1 to 36) then the knockout order above; they are not World Rugby's match numbers. Team ids are the repo's FIFA-style trigrams shared with the flag assets, with IRE for Ireland; flags for CHI, HKG, ITA, GEO, ROU, FIJ, IRE, WAL, TGA, ZIM and SAM are not in apps/web/public/flags yet. world_rank and fifa_rank both hold the World Rugby ranking of 1 December 2025 (the draw seeding); the pool tiebreak uses the ranking of 18 October 2027, so refresh before the pool stage ends. pre_tournament_implied_win values are rough estimates, not market data. Kickoff times are local as published, converted to UTC with the zone the source gives per match, and agree with the official list. Venue names are the official list's (Brisbane Stadium is Lang Park).",
  },
  id: "rwc-2027",
  name: "Men's Rugby World Cup 2027",
  sport: "rugby_union",
  start_utc: group_fixtures[0].kickoff_utc,
  final_utc: knockouts[knockouts.length - 1].kickoff_utc,
  teams,
  groups,
  group_fixtures,
  knockouts,
  advancement: { automatic_per_group: 2, wildcard_third: 4, wildcard_fourth: 0 },
  annex_c_assignments: R16_THIRDS,
};

await writeFile(OUT, JSON.stringify(tournament, null, 2) + "\n");
console.log(`wrote ${OUT}: ${group_fixtures.length} pool matches, ${knockouts.length} knockouts`);
