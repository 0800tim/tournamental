/**
 * Verified-Pundit compute.
 *
 * Foundation for the future contributor-revenue-share signal (docs/19).
 * The qualifier rule for v0.1 is intentionally simple:
 *
 *   A user is a "Verified Pundit" if they finished in the top-100 of any
 *   *settled* tournament's overall (global) leaderboard. Each qualifying
 *   tournament adds one "level" to the badge.
 *
 * Design notes (planned evolution — TODO, not implemented here):
 *   - Rolling 12-month window, not lifetime.
 *   - Humanness-Score-weighted: bots-or-near-bots can't earn the badge.
 *   - Tournament-difficulty-weighted: a top-100 in a 5,000,000-entrant
 *     World Cup ≠ a top-100 in a 200-entrant Sunday-league pool.
 *   - Drips Network revenue-share hook: pundits at level >= 3 (TBD)
 *     accrue a contributor-share allocation. Implementation parked per
 *     CLAUDE.md (don't build payouts in this PR).
 *
 * Side-effect surface (intentional):
 *   - Writes one row per qualified user to the `verified_pundit_records`
 *     table via `GameStore.upsertPunditRecord`.
 *   - Emits one JSONL line per qualifying record to
 *     `data/verified_pundit_v1.jsonl` so downstream batch jobs (and any
 *     future Drips integration) can replay the audit trail without
 *     hitting the DB. The file is append-only and each compute run starts
 *     a fresh "EPOCH" line so consumers know where the boundary is.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { GameStore, VerifiedPunditRecordRow } from "../store/db.js";

/** Top-N rank that earns the badge in v0.1. */
export const PUNDIT_TOP_N = 100;

/** Default audit JSONL path — overridable for tests. */
export function defaultPunditJsonlPath(): string {
  return resolve(
    process.env.GAME_PUNDIT_JSONL_PATH ?? "./apps/game/data/verified_pundit_v1.jsonl",
  );
}

export interface PunditComputeOptions {
  readonly store: GameStore;
  /** Override the audit JSONL path (e.g. tmp dir for tests). */
  readonly jsonlPath?: string;
  readonly now?: () => number;
  /** Top-N qualifier (defaults to 100). */
  readonly topN?: number;
  /** Suppress JSONL writing entirely (tests). */
  readonly suppressJsonl?: boolean;
}

export interface PunditComputeResult {
  readonly tournamentsScanned: number;
  readonly qualified: number;
  /** Per-tournament breakdown for logging / admin telemetry. */
  readonly perTournament: ReadonlyArray<{
    tournamentId: string;
    qualified: number;
    settledAt: number;
  }>;
}

/**
 * Re-compute the Verified-Pundit table for every settled tournament.
 *
 * Idempotent: running twice on the same DB produces the same rows. We
 * delete the per-tournament records first so users who *fell out* of the
 * top-100 (e.g. because the leaderboard was extended after re-scoring)
 * don't keep stale qualifications.
 *
 * Cost: O(T × 100) on the SQLite leaderboard index, plus one DB write
 * per qualifier. Trivial at v0.1 scale.
 */
export function recomputeVerifiedPundits(
  opts: PunditComputeOptions,
): PunditComputeResult {
  const { store, suppressJsonl } = opts;
  const now = opts.now ?? Date.now;
  const topN = opts.topN ?? PUNDIT_TOP_N;
  const jsonlPath = opts.jsonlPath ?? defaultPunditJsonlPath();

  const settled = store.listSettledTournaments();
  const stamp = now();

  // Open the JSONL (append) once per run; mark the epoch boundary.
  let appendLine: ((line: string) => void) | null = null;
  if (!suppressJsonl) {
    try {
      mkdirSync(dirname(jsonlPath), { recursive: true });
      const epochLine =
        JSON.stringify({
          type: "epoch",
          stamped_at: stamp,
          tournaments: settled.map((t) => t.id),
        }) + "\n";
      appendFileSync(jsonlPath, epochLine, "utf8");
      appendLine = (line: string) => appendFileSync(jsonlPath, line, "utf8");
    } catch {
      // JSONL write failure must never break the in-DB compute.
      appendLine = null;
    }
  }

  const perTournament: Array<{
    tournamentId: string;
    qualified: number;
    settledAt: number;
  }> = [];
  let qualified = 0;

  for (const t of settled) {
    // Wipe and re-stamp this tournament's qualifiers so the table reflects
    // the current top-N exactly — no stale rows accrue across recomputes.
    store.clearPunditRecordsForTournament(t.id);
    const rows = store.topN(t.id, topN);
    let perTournQualified = 0;

    store.transaction(() => {
      rows.forEach((row, idx) => {
        // Only users with a positive score are "verified" — a bracket that
        // never scored is a participant, not a pundit. This avoids
        // accidentally minting badges when only a handful of brackets are
        // submitted in a tiny tournament.
        if (row.score_total <= 0) return;
        const finalRank = idx + 1;
        store.upsertPunditRecord({
          userId: row.user_id,
          tournamentId: t.id,
          finalRank,
          scoreTotal: row.score_total,
          stampedAt: stamp,
        });
        perTournQualified++;
        qualified++;
        if (appendLine) {
          appendLine(
            JSON.stringify({
              type: "qualifier",
              user_id: row.user_id,
              tournament_id: t.id,
              final_rank: finalRank,
              score_total: row.score_total,
              stamped_at: stamp,
            }) + "\n",
          );
        }
      });
    });

    perTournament.push({
      tournamentId: t.id,
      qualified: perTournQualified,
      settledAt: t.settled_at ?? 0,
    });
  }

  return {
    tournamentsScanned: settled.length,
    qualified,
    perTournament,
  };
}

/** Public response shape served by `GET /v1/users/:userId/pundit`. */
export interface PunditStatus {
  readonly verified: boolean;
  readonly levels: number;
  readonly sinceDate: string | null;
  readonly tournaments: ReadonlyArray<string>;
}

/**
 * Roll up a user's records into the public pundit-status payload.
 *
 * Pure helper — no DB I/O — so it's trivial to unit-test and reuse from
 * server-side renders (Customer-360, OG card generators, etc.).
 */
export function rollupPunditStatus(
  records: ReadonlyArray<VerifiedPunditRecordRow>,
): PunditStatus {
  if (records.length === 0) {
    return { verified: false, levels: 0, sinceDate: null, tournaments: [] };
  }
  // Sort by stamp ascending so `sinceDate` is the *earliest* qualification.
  const sorted = [...records].sort((a, b) => a.stamped_at - b.stamped_at);
  const since = sorted[0].stamped_at;
  return {
    verified: true,
    levels: sorted.length,
    sinceDate: new Date(since).toISOString(),
    tournaments: sorted.map((r) => r.tournament_id),
  };
}
