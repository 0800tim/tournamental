/**
 * Shared test fixtures.
 *
 * Every test gets its own in-memory DB so they don't bleed state.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import type { Bracket, MatchPrediction } from "@vtorn/bracket-engine";

import { buildServer } from "../src/server.js";
import type { KickoffRegistry, KickoffLookup } from "../src/kickoffs.js";

const ADMIN_TOKEN = "test-admin-token";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

export interface TestServerOpts {
  adminToken?: string | null;
  cacheTtlMs?: number;
  kickoffs?: KickoffRegistry;
  /** Override the clock (defaults to a fixed pre-tournament instant). */
  nowMs?: () => number;
}

export async function makeServer(opts: TestServerOpts = {}) {
  return buildServer({
    dbPath: ":memory:",
    migrationsDir: MIGRATIONS_DIR,
    adminToken: opts.adminToken === undefined ? ADMIN_TOKEN : opts.adminToken,
    cacheTtlMs: opts.cacheTtlMs ?? 100,
    rateLimit: false,
    kickoffs: opts.kickoffs,
    nowMs: opts.nowMs,
  });
}

/**
 * Build a stub kickoff registry that returns fixed kickoffs for one
 * tournament's matches. Anything not in `kickoffs` is treated as
 * "kickoff unknown" (and therefore lockable).
 */
export function makeStubRegistry(
  tournamentId: string,
  kickoffs: Record<string, string>,
  stages: Record<string, string> = {},
): KickoffRegistry {
  const defaultStageFor = (matchId: string): string | null => {
    if (matchId in stages) return stages[matchId] ?? null;
    if (/^\d+$/.test(matchId)) return "group";
    if (matchId.startsWith("r32")) return "r32";
    if (matchId.startsWith("r16")) return "r16";
    if (matchId.startsWith("qf")) return "qf";
    if (matchId.startsWith("sf")) return "sf";
    if (matchId === "tp" || matchId === "third_place") return "tp";
    if (matchId === "final" || matchId === "f") return "f";
    return null;
  };
  const lookup: KickoffLookup = {
    tournamentId,
    kickoffFor: (matchId: string) => kickoffs[matchId] ?? null,
    stageFor: defaultStageFor,
  };
  const empty: KickoffLookup = {
    tournamentId: "",
    kickoffFor: () => null,
    stageFor: () => null,
  };
  return {
    forTournament: (tid: string) => (tid === tournamentId ? lookup : empty),
  };
}

export const TEST_ADMIN_TOKEN = ADMIN_TOKEN;

export function makeMatchPrediction(
  matchId: string,
  outcome: MatchPrediction["outcome"],
  partial: Partial<MatchPrediction> = {},
): MatchPrediction {
  return {
    matchId,
    outcome,
    lockedAt: "2026-06-01T00:00:00Z",
    ...partial,
  };
}

export function makeBracket(
  bracketId: string,
  matchPredictions: Record<string, MatchPrediction> = {},
  knockoutPredictions: Record<string, MatchPrediction> = {},
): Bracket {
  return {
    bracketId,
    matchPredictions,
    groupTiebreakers: {},
    knockoutPredictions,
    lockedAt: "2026-06-01T00:00:00Z",
    version: 1,
  };
}
