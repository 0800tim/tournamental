/**
 * Final standings for an archived tournament, read directly from the
 * restored game.db (read-only). Exposes RANK and PERCENT CORRECT only:
 * the archive never shows how many people played (Tim 2026-10-15).
 *
 * Names come from syndicate_owners_membership (handle / display_name)
 * with a fallback to the auth-sms user table when AUTH_DB_PATH is set,
 * mirroring lib/syndicate/enrich-members.ts. Players with no handle on
 * record are shown as "Player".
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

export interface FinalStandingRow {
  readonly rank: number;
  readonly name: string;
  readonly percentCorrect: number;
  readonly correct: number;
  readonly points: number;
}

export interface KnockoutResultRow {
  readonly matchId: string;
  readonly stage: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly winner: string | null;
  readonly method: string | null;
}

function gameDbPath(): string {
  const explicit = process.env.VTORN_GAME_DB_PATH || process.env.GAME_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  return resolve(process.cwd(), "..", "..", "apps/game/data/game.db");
}

function authDbPath(): string | null {
  return process.env.AUTH_DB_PATH ?? process.env.AUTH_SMS_DB_PATH ?? null;
}

export function loadFinalStandings(
  tournamentId: string,
  totalMatches: number,
  limit = 10,
): FinalStandingRow[] {
  const p = gameDbPath();
  if (!existsSync(p)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(p, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT b.user_id, b.score_total, b.correct_picks,
                (SELECT COALESCE(m.display_name, m.handle)
                   FROM syndicate_owners_membership m
                  WHERE m.user_id = b.user_id
                    AND COALESCE(m.display_name, m.handle) IS NOT NULL
                  LIMIT 1) AS name
           FROM brackets b
          WHERE b.tournament_id = ?
          ORDER BY b.score_total DESC, b.correct_picks DESC, b.locked_at ASC
          LIMIT ?`,
      )
      .all(tournamentId, limit) as Array<{
      user_id: string;
      score_total: number;
      correct_picks: number;
      name: string | null;
    }>;

    const missing = rows.filter((r) => !r.name).map((r) => r.user_id);
    const authNames = new Map<string, string>();
    const ap = authDbPath();
    if (missing.length > 0 && ap && existsSync(ap)) {
      try {
        const adb = new Database(ap, { readonly: true, fileMustExist: true });
        const q = adb.prepare(`SELECT id, display_name FROM user WHERE id = ?`);
        for (const id of missing) {
          const r = q.get(id) as { id: string; display_name: string | null } | undefined;
          if (r?.display_name) authNames.set(id, r.display_name);
        }
        adb.close();
      } catch {
        /* auth DB optional */
      }
    }

    return rows.map((r, i) => ({
      rank: i + 1,
      name: r.name ?? authNames.get(r.user_id) ?? "Player",
      correct: r.correct_picks,
      points: r.score_total,
      percentCorrect: Math.round((r.correct_picks / Math.max(1, totalMatches)) * 100),
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * Knockout stages as the archive home lists them: final first, back to
 * the round of 32. Shared with the page so the list and the loader
 * cannot drift apart again (the round of 32 was missing until
 * 2026-10-17 because the page's order started at r16).
 */
export const KNOCKOUT_STAGE_ORDER: readonly string[] = ["f", "tp", "sf", "qf", "r16", "r32"];

export const KNOCKOUT_STAGE_LABEL: Record<string, string> = {
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  tp: "Third place",
  f: "Final",
};

/**
 * The final's match id is `final` (no underscore), so the id-derived
 * stage would be "final" while the page lists "f" (review 343-1).
 */
function normaliseStage(stage: string): string {
  return stage === "final" ? "f" : stage;
}

/** Knockout results ordered by match id, which the fixtures zero-pad
 *  (r16_01, r16_02, ...), so each stage lists in bracket order rather
 *  than the order results happened to be recorded (review 343-4). */
export function loadKnockoutResults(tournamentId: string): KnockoutResultRow[] {
  const p = gameDbPath();
  if (!existsSync(p)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(p, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT match_id, outcome FROM match_results
          WHERE tournament_id = ?
            AND (match_id LIKE 'r32%' OR match_id LIKE 'r16%' OR match_id LIKE 'qf%'
                 OR match_id LIKE 'sf%' OR match_id LIKE 'tp%' OR match_id = 'final')
          ORDER BY match_id ASC`,
      )
      .all(tournamentId) as Array<{ match_id: string; outcome: string }>;
    return rows.map((r) => {
      let o: Record<string, unknown> = {};
      try {
        o = JSON.parse(r.outcome) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      return {
        matchId: r.match_id,
        stage: normaliseStage(String(o.stage ?? r.match_id.split("_")[0])),
        homeScore: typeof o.homeScore === "number" ? o.homeScore : null,
        awayScore: typeof o.awayScore === "number" ? o.awayScore : null,
        winner: typeof o.winner === "string" ? o.winner : null,
        method: typeof o.method === "string" ? o.method : null,
      };
    });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
