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

const ADMIN_TOKEN = "test-admin-token";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

export interface TestServerOpts {
  adminToken?: string | null;
  cacheTtlMs?: number;
}

export async function makeServer(opts: TestServerOpts = {}) {
  return buildServer({
    dbPath: ":memory:",
    migrationsDir: MIGRATIONS_DIR,
    adminToken: opts.adminToken === undefined ? ADMIN_TOKEN : opts.adminToken,
    cacheTtlMs: opts.cacheTtlMs ?? 100,
    rateLimit: false,
  });
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
