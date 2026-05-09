/**
 * Demo team loader.
 *
 * Default rosters mirror `spec/examples/match-init.json` — a Blue United vs
 * Red Rovers fixture with full 11-player squads + 7 substitutes per side.
 * `--teams <path.json>` lets a caller override with a custom MatchInit-like
 * blob; the file is required to contain `teams: [Team, Team]`.
 */
import { readFile } from "node:fs/promises";
import type { Player, Team } from "@vtorn/spec";

export interface TeamsBundle {
  teams: [Team, Team];
}

const DEFAULT_TEAMS: [Team, Team] = [
  {
    id: "BLU",
    name: "Blue United",
    short_name: "BLU",
    kit: {
      primary: "#1E3A8A",
      secondary: "#FFFFFF",
      text: "#FFFFFF",
      goalkeeper: { primary: "#FACC15", secondary: "#1E3A8A", text: "#1E3A8A" },
    },
    players: [
      { id: "BLU_1", name: "G. Keeper", number: 1, position: "GK" },
      { id: "BLU_2", name: "R. Back", number: 2, position: "RB" },
      { id: "BLU_3", name: "C. Defender", number: 3, position: "CB" },
      { id: "BLU_4", name: "C. Centre", number: 4, position: "CB" },
      { id: "BLU_5", name: "L. Back", number: 5, position: "LB" },
      { id: "BLU_6", name: "D. Mid", number: 6, position: "DM" },
      { id: "BLU_8", name: "C. Mid", number: 8, position: "CM" },
      { id: "BLU_10", name: "A. Mid", number: 10, position: "AM" },
      { id: "BLU_7", name: "R. Wing", number: 7, position: "RW" },
      { id: "BLU_11", name: "L. Wing", number: 11, position: "LW" },
      { id: "BLU_9", name: "S. Triker", number: 9, position: "ST" },
      // bench
      { id: "BLU_12", name: "B. Eckup", number: 12, position: "GK" },
      { id: "BLU_13", name: "U. Tility", number: 13, position: "CB" },
      { id: "BLU_14", name: "S. Pare", number: 14, position: "LB" },
      { id: "BLU_15", name: "R. Eserve", number: 15, position: "CM" },
      { id: "BLU_16", name: "I. Mpact", number: 16, position: "AM" },
      { id: "BLU_17", name: "F. Resh", number: 17, position: "RW" },
      { id: "BLU_18", name: "P. Lan-B", number: 18, position: "ST" },
    ],
  },
  {
    id: "RED",
    name: "Red Rovers",
    short_name: "RED",
    kit: {
      primary: "#B91C1C",
      secondary: "#000000",
      text: "#FFFFFF",
      goalkeeper: { primary: "#10B981", secondary: "#000000", text: "#FFFFFF" },
    },
    players: [
      { id: "RED_1", name: "K. Eeper", number: 1, position: "GK" },
      { id: "RED_2", name: "F. Back", number: 2, position: "RB" },
      { id: "RED_3", name: "C. Henter", number: 3, position: "CB" },
      { id: "RED_4", name: "C. Pair", number: 4, position: "CB" },
      { id: "RED_5", name: "B. Left", number: 5, position: "LB" },
      { id: "RED_6", name: "M. Field", number: 6, position: "DM" },
      { id: "RED_8", name: "C. Mid", number: 8, position: "CM" },
      { id: "RED_10", name: "A. Number", number: 10, position: "AM" },
      { id: "RED_7", name: "W. Inger", number: 7, position: "RW" },
      { id: "RED_11", name: "L. Side", number: 11, position: "LW" },
      { id: "RED_9", name: "G. Olscorer", number: 9, position: "ST" },
      // bench
      { id: "RED_12", name: "K. Eeper2", number: 12, position: "GK" },
      { id: "RED_13", name: "S. Olid", number: 13, position: "CB" },
      { id: "RED_14", name: "F. Resh-Legs", number: 14, position: "RB" },
      { id: "RED_15", name: "L. Inkup", number: 15, position: "CM" },
      { id: "RED_16", name: "C. Reative", number: 16, position: "AM" },
      { id: "RED_17", name: "S. Peed", number: 17, position: "LW" },
      { id: "RED_18", name: "P. Oacher", number: 18, position: "ST" },
    ],
  },
];

export function defaultTeams(): [Team, Team] {
  // Deep clone so callers can mutate without poisoning the constant.
  return JSON.parse(JSON.stringify(DEFAULT_TEAMS)) as [Team, Team];
}

export async function loadTeamsFromPath(path: string): Promise<[Team, Team]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<TeamsBundle> & { teams?: Team[] };
  if (!parsed.teams || !Array.isArray(parsed.teams) || parsed.teams.length !== 2) {
    throw new Error(`--teams JSON at ${path} must contain "teams" array of length 2`);
  }
  for (const t of parsed.teams) {
    if (!t.id || !t.name || !t.kit || !Array.isArray(t.players)) {
      throw new Error(`--teams JSON at ${path}: each team needs id, name, kit, players[]`);
    }
    if (t.players.length < 11) {
      throw new Error(`--teams JSON at ${path}: team ${t.id} has fewer than 11 players`);
    }
    for (const p of t.players as Player[]) {
      if (!p.id || !p.name || typeof p.number !== "number" || !p.position) {
        throw new Error(`--teams JSON at ${path}: player in team ${t.id} missing required fields`);
      }
    }
  }
  return parsed.teams as [Team, Team];
}
