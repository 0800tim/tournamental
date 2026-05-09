#!/usr/bin/env node
/**
 * Generate `data/fifa-wc-2026-fixtures.json`. Deterministic output —
 * running this twice produces identical bytes (sorted keys, fixed
 * timestamps, fixed seeded ordering).
 *
 * The output is the canonical placeholder shape: 48 placeholder teams,
 * 8 groups of 6, 9 matches per group (Swiss-flavoured short round-robin
 * — each team plays 3 of its 5 group rivals), plus the full knockout
 * dependency graph. Swap real teams + real kickoff times in when FIFA
 * publishes the draw.
 *
 * Run with:  node scripts/generate-fixtures-2026.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "data", "fifa-wc-2026-fixtures.json");

const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const HOSTS = ["US", "CA", "MX"];
const VENUES_US = [
  "MetLife Stadium (NJ)",
  "AT&T Stadium (TX)",
  "SoFi Stadium (CA)",
  "Lumen Field (WA)",
  "Arrowhead Stadium (MO)",
  "Mercedes-Benz Stadium (GA)",
  "Levi's Stadium (CA)",
  "Lincoln Financial Field (PA)",
  "Hard Rock Stadium (FL)",
  "Gillette Stadium (MA)",
  "NRG Stadium (TX)",
];
const VENUES_CA = ["BMO Field (Toronto)", "BC Place (Vancouver)"];
const VENUES_MX = ["Estadio Azteca (CDMX)", "Estadio Akron (Guadalajara)", "Estadio BBVA (Monterrey)"];

// Tournament starts 11 June 2026 16:00 UTC.
const START_UTC = Date.parse("2026-06-11T16:00:00Z");
// Final 19 July 2026 19:00 UTC.
const FINAL_UTC = "2026-07-19T19:00:00Z";

// 48 placeholder teams; same shape as real ones (id, name, country,
// fifa_rank, pre_tournament_implied_win). Swap to real ISO-3166 codes
// when the draw is performed.
const teams = [];
for (let i = 0; i < 48; i++) {
  const slot = String(i + 1).padStart(2, "0");
  // pre_tournament_implied_win curve: top seeds ~0.20, mid ~0.04, low ~0.012
  // (multiply by 24 → average ~0.02, sums to ~1.0 across all 48; intentionally
  // imprecise — it's a placeholder).
  const rank = i + 1; // pseudo-fifa-rank by slot
  const implied = +(0.22 * Math.exp(-i / 14)).toFixed(4);
  teams.push({
    id: `SLOT_${slot}`,
    name: `Placeholder Team ${slot}`,
    country: "PLA",
    fifa_rank: rank,
    pre_tournament_implied_win: implied,
    placeholder: true,
  });
}

// Assign 6 teams to each group, snake-draft by rank so groups are roughly
// balanced. (Real 2026 draw uses 4 pots; placeholder uses snake.)
const groupTeamIds = Object.fromEntries(GROUPS.map((g) => [g, []]));
let direction = 1;
let cursor = 0;
for (let pot = 0; pot < 6; pot++) {
  const order = direction === 1 ? GROUPS : [...GROUPS].reverse();
  for (const g of order) {
    groupTeamIds[g].push(teams[cursor++].id);
  }
  direction = -direction;
}

// 9 matches per group: a "Swiss"-flavoured short round-robin. Each team
// plays 3 of its 5 group rivals. We use the canonical 6-team round-robin
// schedule and pick rounds 1, 3, 5 (every other round). 5 rounds total
// in a full RR; 3 chosen rounds × 3 matches each = 9 matches per group.
//
// 6-team circle method, fixing team 0 and rotating teams 1..5:
function fullRoundRobin6() {
  const rounds = [];
  const arr = [0, 1, 2, 3, 4, 5];
  for (let r = 0; r < 5; r++) {
    const pairs = [];
    for (let i = 0; i < 3; i++) {
      pairs.push([arr[i], arr[5 - i]]);
    }
    rounds.push(pairs);
    // rotate (keep arr[0] fixed)
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}
const groupRounds = fullRoundRobin6().filter((_, idx) => idx % 2 === 0); // rounds 1, 3, 5 (0-indexed: 0, 2, 4)

let matchNo = 1;
const groupFixtures = [];
// Spread group matches across the first 12 days. 72 group matches over 12
// days = 6 per day. 6 per day × 4 hour slots = ~1.5/slot.
const GROUP_DAYS = 12;
let slotIndex = 0;
for (let roundIdx = 0; roundIdx < groupRounds.length; roundIdx++) {
  for (const g of GROUPS) {
    for (const [aIdx, bIdx] of groupRounds[roundIdx]) {
      const dayOffset = Math.floor(slotIndex / 6);
      const hourOffset = (slotIndex % 6) * 3 + 16; // start at 16:00 UTC, step 3h, wrap into day
      const day = dayOffset % GROUP_DAYS;
      const kickoffMs = START_UTC + day * 86400000 + (hourOffset - 16) * 3600000;
      const host = HOSTS[matchNo % HOSTS.length];
      const venues = host === "US" ? VENUES_US : host === "CA" ? VENUES_CA : VENUES_MX;
      const venue = venues[matchNo % venues.length];
      groupFixtures.push({
        match_no: matchNo++,
        group_id: g,
        home_idx: aIdx,
        away_idx: bIdx,
        kickoff_utc: new Date(kickoffMs).toISOString(),
        host,
        venue,
      });
      slotIndex++;
    }
  }
}

// Knockouts. Match numbers continue from group stage.
// R32: 16 matches. Slot pairings — each match takes a 1st/2nd of a group
// or a wildcard third/fourth. We use a canonical pairing that mirrors
// FIFA bracket logic for a 32-team R32:
//
//   Match  Home (1st of X)   Away (2nd of Y or wildcard)
//   r32_01 1A                2B
//   r32_02 1C                2D
//   r32_03 1E                2F
//   r32_04 1G                2H
//   r32_05 1B                2A
//   r32_06 1D                2C
//   r32_07 1F                2E
//   r32_08 1H                2G
//   r32_09 3A (best 3rd #1)  4A (best 4th #1)
//   r32_10 3B (best 3rd #2)  4B (best 4th #2)
//   r32_11 3C (best 3rd #3)  4C (best 4th #3)
//   r32_12 3D (best 3rd #4)  4D (best 4th #4)
//   r32_13 3E (best 3rd #5)  4E (best 4th #5)
//   r32_14 3F (best 3rd #6)  4F (best 4th #6)
//   r32_15 3G (best 3rd #7)  4G (best 4th #7)
//   r32_16 3H (best 3rd #8)  4H (best 4th #8)
//
// Real FIFA rules will be different. Keep this clean and replaceable.

const knockouts = [];
const allGroupIds = [...GROUPS];

// R32 — 16 matches
const r32 = [
  ["1A", "2B"], ["1C", "2D"], ["1E", "2F"], ["1G", "2H"],
  ["1B", "2A"], ["1D", "2C"], ["1F", "2E"], ["1H", "2G"],
  ["3*1", "4*1"], ["3*2", "4*2"], ["3*3", "4*3"], ["3*4", "4*4"],
  ["3*5", "4*5"], ["3*6", "4*6"], ["3*7", "4*7"], ["3*8", "4*8"],
];

function parseSlot(spec) {
  if (spec.startsWith("3*")) {
    return { kind: "best_third", rank: +spec.slice(2), eligible_groups: allGroupIds };
  }
  if (spec.startsWith("4*")) {
    return { kind: "best_fourth", rank: +spec.slice(2), eligible_groups: allGroupIds };
  }
  // "1A" etc.
  const pos = +spec[0];
  const grp = spec[1];
  return { kind: "group_position", group: grp, position: pos };
}

let knockoutDay = GROUP_DAYS + 1; // give 1 rest day
for (let i = 0; i < r32.length; i++) {
  const [home, away] = r32[i];
  const host = HOSTS[i % HOSTS.length];
  const venues = host === "US" ? VENUES_US : host === "CA" ? VENUES_CA : VENUES_MX;
  const dayOffset = knockoutDay + Math.floor(i / 4);
  const hourOffset = (i % 4) * 3 + 16;
  const kickoffMs = START_UTC + dayOffset * 86400000 + (hourOffset - 16) * 3600000;
  knockouts.push({
    id: `r32_${String(i + 1).padStart(2, "0")}`,
    stage: "r32",
    match_no: matchNo++,
    home: parseSlot(home),
    away: parseSlot(away),
    kickoff_utc: new Date(kickoffMs).toISOString(),
    host,
    venue: venues[i % venues.length],
  });
}
knockoutDay += 4; // 4 days for R32 (16 matches / 4 per day)

// R16 — 8 matches
for (let i = 0; i < 8; i++) {
  const homeMatch = `r32_${String(i * 2 + 1).padStart(2, "0")}`;
  const awayMatch = `r32_${String(i * 2 + 2).padStart(2, "0")}`;
  const host = HOSTS[i % HOSTS.length];
  const venues = host === "US" ? VENUES_US : host === "CA" ? VENUES_CA : VENUES_MX;
  const dayOffset = knockoutDay + Math.floor(i / 2);
  const hourOffset = (i % 2) * 4 + 16;
  const kickoffMs = START_UTC + dayOffset * 86400000 + (hourOffset - 16) * 3600000;
  knockouts.push({
    id: `r16_${String(i + 1).padStart(2, "0")}`,
    stage: "r16",
    match_no: matchNo++,
    home: { kind: "knockout_winner", match_id: homeMatch },
    away: { kind: "knockout_winner", match_id: awayMatch },
    kickoff_utc: new Date(kickoffMs).toISOString(),
    host,
    venue: venues[i % venues.length],
  });
}
knockoutDay += 4;

// QF — 4 matches
for (let i = 0; i < 4; i++) {
  const homeMatch = `r16_${String(i * 2 + 1).padStart(2, "0")}`;
  const awayMatch = `r16_${String(i * 2 + 2).padStart(2, "0")}`;
  const host = HOSTS[i % HOSTS.length];
  const venues = host === "US" ? VENUES_US : host === "CA" ? VENUES_CA : VENUES_MX;
  const dayOffset = knockoutDay + Math.floor(i / 2);
  const hourOffset = (i % 2) * 4 + 16;
  const kickoffMs = START_UTC + dayOffset * 86400000 + (hourOffset - 16) * 3600000;
  knockouts.push({
    id: `qf_${String(i + 1).padStart(2, "0")}`,
    stage: "qf",
    match_no: matchNo++,
    home: { kind: "knockout_winner", match_id: homeMatch },
    away: { kind: "knockout_winner", match_id: awayMatch },
    kickoff_utc: new Date(kickoffMs).toISOString(),
    host,
    venue: venues[i % venues.length],
  });
}
knockoutDay += 3;

// SF — 2 matches
for (let i = 0; i < 2; i++) {
  knockouts.push({
    id: `sf_${String(i + 1).padStart(2, "0")}`,
    stage: "sf",
    match_no: matchNo++,
    home: { kind: "knockout_winner", match_id: `qf_${String(i * 2 + 1).padStart(2, "0")}` },
    away: { kind: "knockout_winner", match_id: `qf_${String(i * 2 + 2).padStart(2, "0")}` },
    kickoff_utc: new Date(START_UTC + (knockoutDay + i) * 86400000).toISOString(),
    host: "US",
    venue: i === 0 ? "MetLife Stadium (NJ)" : "AT&T Stadium (TX)",
  });
}
knockoutDay += 3;

// 3rd place play-off — 1 match
knockouts.push({
  id: "tp_01",
  stage: "sf", // semifinal stage multiplier; not consumed by anything downstream
  match_no: matchNo++,
  home: { kind: "knockout_loser", match_id: "sf_01" },
  away: { kind: "knockout_loser", match_id: "sf_02" },
  kickoff_utc: new Date(START_UTC + (knockoutDay) * 86400000).toISOString(),
  host: "US",
  venue: "Lincoln Financial Field (PA)",
});
knockoutDay += 1;

// Final
knockouts.push({
  id: "final",
  stage: "f",
  match_no: matchNo++,
  home: { kind: "knockout_winner", match_id: "sf_01" },
  away: { kind: "knockout_winner", match_id: "sf_02" },
  kickoff_utc: FINAL_UTC,
  host: "US",
  venue: "MetLife Stadium (NJ)",
});

// Build groups list
const groups = GROUPS.map((g) => ({ id: g, team_ids: groupTeamIds[g] }));

const tournament = {
  _meta: {
    source: "Generated placeholder by scripts/generate-fixtures-2026.mjs",
    source_url: "https://www.fifa.com/fifaplus/en/tournaments/mens/worldcup/canadamexicousa2026",
    schedule_status: "placeholder",
    fetched_at_utc: "2026-05-09T00:00:00Z",
    notes: [
      "48 teams in 8 groups of 6. Each team plays 3 of its 5 group rivals (Swiss-flavoured short round-robin) for 9 matches per group, 72 group matches total.",
      "Knockouts: R32 (16) + R16 (8) + QF (4) + SF (2) + 3rd-place play-off (1) + Final (1) = 32 matches. Total: 104 matches.",
      "NOTE: official FIFA 2026 format is 12 groups of 4 with a R32. This file uses the VTourn product brief (8 groups of 6). When the official 2026 draw is published, regenerate by replacing team names + kickoff_utc per match. The engine's advancement rules (1st+2nd+wildcard thirds+wildcard fourths) and knockout slot graph stay structurally the same.",
      "Replace team ids (currently SLOT_01..SLOT_48) with ISO-3166 alpha-3 codes once the draw is performed.",
    ].join(" "),
  },
  id: "fifa-wc-2026",
  name: "FIFA World Cup 2026 (US / Canada / Mexico)",
  start_utc: new Date(START_UTC).toISOString(),
  final_utc: FINAL_UTC,
  teams,
  groups,
  group_fixtures: groupFixtures,
  knockouts,
  advancement: {
    automatic_per_group: 2,
    wildcard_third: 8,
    wildcard_fourth: 8,
  },
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(tournament, null, 2) + "\n");
process.stdout.write(`wrote ${OUT}: ${groupFixtures.length} group + ${knockouts.length} knockout = ${groupFixtures.length + knockouts.length} matches\n`);
