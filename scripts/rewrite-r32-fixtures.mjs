#!/usr/bin/env node
// One-off: rewrite the 16 R32 KnockoutFixture home/away slot sources in
// fifa-wc-2026-fixtures.json to the FIFA-official 2026 R32 structure
// (Wikipedia "2026 FIFA World Cup knockout stage" + the captured Annex C
// table). Venue, kickoff, id, host, stage, and match_no are preserved.

import { readFileSync, writeFileSync } from "node:fs";

const path = new globalThis.URL(
  "../packages/bracket-engine/data/fifa-wc-2026-fixtures.json",
  import.meta.url,
);
const j = JSON.parse(readFileSync(path, "utf-8"));

// FIFA-official 2026 R32 structure. Match numbers come from the
// schedule. Order: home is listed first.
//   2X = group runner-up of group X
//   1X = group winner of group X
//   3rd = a best-third routed by FIFA Annex C; the third's group winner
//         opponent (the group_winner field) is the GROUP letter of the
//         home team in that match (always one of A B D E G I K L).
//
// Sources:
//   - https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage
//   - packages/bracket-engine/data/fifa-2026-annex-c-assignments.json
const R32_STRUCTURE = {
  73: { home: { kind: "group_position", group: "A", position: 2 }, away: { kind: "group_position", group: "B", position: 2 } },
  74: { home: { kind: "group_position", group: "E", position: 1 }, away: { kind: "annex_c_third", group_winner: "E" } },
  75: { home: { kind: "group_position", group: "F", position: 1 }, away: { kind: "group_position", group: "C", position: 2 } },
  76: { home: { kind: "group_position", group: "C", position: 1 }, away: { kind: "group_position", group: "F", position: 2 } },
  77: { home: { kind: "group_position", group: "I", position: 1 }, away: { kind: "annex_c_third", group_winner: "I" } },
  78: { home: { kind: "group_position", group: "E", position: 2 }, away: { kind: "group_position", group: "I", position: 2 } },
  79: { home: { kind: "group_position", group: "A", position: 1 }, away: { kind: "annex_c_third", group_winner: "A" } },
  80: { home: { kind: "group_position", group: "L", position: 1 }, away: { kind: "annex_c_third", group_winner: "L" } },
  81: { home: { kind: "group_position", group: "D", position: 1 }, away: { kind: "annex_c_third", group_winner: "D" } },
  82: { home: { kind: "group_position", group: "G", position: 1 }, away: { kind: "annex_c_third", group_winner: "G" } },
  83: { home: { kind: "group_position", group: "K", position: 2 }, away: { kind: "group_position", group: "L", position: 2 } },
  84: { home: { kind: "group_position", group: "H", position: 1 }, away: { kind: "group_position", group: "J", position: 2 } },
  85: { home: { kind: "group_position", group: "B", position: 1 }, away: { kind: "annex_c_third", group_winner: "B" } },
  86: { home: { kind: "group_position", group: "J", position: 1 }, away: { kind: "group_position", group: "H", position: 2 } },
  87: { home: { kind: "group_position", group: "K", position: 1 }, away: { kind: "annex_c_third", group_winner: "K" } },
  88: { home: { kind: "group_position", group: "D", position: 2 }, away: { kind: "group_position", group: "G", position: 2 } },
};

let updated = 0;
for (const ko of j.knockouts) {
  if (ko.stage !== "r32") continue;
  const next = R32_STRUCTURE[ko.match_no];
  if (!next) {
    console.error(`! No FIFA structure for R32 match ${ko.match_no}`);
    continue;
  }
  ko.home = next.home;
  ko.away = next.away;
  updated++;
}

// Bump the meta notes so the source-of-truth shift is recorded.
const stamp = new Date().toISOString();
const note = ` // ${stamp.slice(0, 10)}: R32 home/away slot sources rewritten to FIFA-official 2026 structure (Annex C-routed thirds in 8 matches, 2-vs-2 runner-up pairings in 4 matches, group-winner-vs-runner-up in 4 matches).`;
if (!j._meta.notes.includes("R32 home/away slot sources rewritten")) {
  j._meta.notes = j._meta.notes + note;
}

writeFileSync(path, JSON.stringify(j, null, 2) + "\n");
console.error(`Rewrote ${updated} R32 fixtures.`);
