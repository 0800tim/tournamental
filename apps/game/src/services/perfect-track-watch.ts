/**
 * Perfect-bracket-track alert service.
 *
 * Scans the latest swarm_summary row for every operator and emits an
 * alert row for any operator that still has bots alive after match 80.
 * Each alert is idempotent on (operator_id, match_number) so re-running
 * the watcher does not duplicate notifications.
 *
 * Side-effects:
 *   - Persists rows into `perfect_track_alert` (consumed by the home
 *     page + the /leaderboard badge).
 *   - Logs an info entry per fresh alert.
 *   - POSTs a JSON notification to the PERFECT_TRACK_WEBHOOK_URL env
 *     var (optional, no-op if unset). Failures are absorbed silently
 *     because a missing webhook should never block scoring.
 *
 * Trigger surfaces:
 *   - apps/game/src/routes/swarms.ts POST handler runs this inline
 *     after a summary is published so the badge updates immediately.
 *   - apps/game/src/routes/match.ts (admin scoring) calls this after
 *     each match's scoring completes so newly-published summaries with
 *     a high-match-number frontier are surfaced even when no fresh
 *     summary triggered the watcher.
 *
 * Spec: A13 task brief.
 */
import type { GameStore } from "../store/db.js";
import type { SwarmSummaryRow } from "../store/swarm-summaries.js";

/** Threshold for "still on a perfect track". Match 80 = the spec hook. */
export const PERFECT_TRACK_MATCH_THRESHOLD = 80;

export interface PerfectTrackAlert {
  operator_id: string;
  match_number: number;
  alive_count: number;
}

export interface RunWatchDeps {
  readonly store: GameStore;
  readonly now: number;
  /** Override the env-driven webhook URL (tests). */
  readonly webhookUrl?: string | null;
  /** Inject fetch (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Optional logger; falls back to console.info. */
  readonly logger?: { info: (data: unknown, msg?: string) => void };
}

export interface RunWatchResult {
  alertsRecorded: PerfectTrackAlert[];
  webhookPosted: number;
}

/**
 * Inspect every operator's latest summary and record an alert per
 * operator whose alive_count at match >= 80 is > 0.
 *
 * Synchronous DB work; the webhook POST is fired-and-forgotten via the
 * returned promise so callers can await if they want determinism in
 * tests.
 */
export function runPerfectTrackWatch(deps: RunWatchDeps): RunWatchResult {
  const alerts: PerfectTrackAlert[] = [];
  const summaries = deps.store.swarmSummaries.latestPerOperator();
  for (const row of summaries) {
    const alert = pickHighestAlive(row);
    if (alert) {
      deps.store.perfectTrackAlerts.recordAlert({
        operator_id: alert.operator_id,
        match_number: alert.match_number,
        alive_count: alert.alive_count,
        now: deps.now,
      });
      alerts.push(alert);
    }
  }

  if (alerts.length > 0) {
    const logger = deps.logger ?? console;
    logger.info(
      {
        count: alerts.length,
        operators: alerts.map((a) => ({
          operator_id_short: a.operator_id.slice(0, 12),
          match_number: a.match_number,
          alive_count: a.alive_count,
        })),
      },
      "perfect-track alert",
    );
  }

  // Webhook is fire-and-forget; the synchronous return value never
  // blocks on the network call.
  const webhookUrl =
    deps.webhookUrl !== undefined
      ? deps.webhookUrl
      : process.env.PERFECT_TRACK_WEBHOOK_URL ?? null;
  let webhookPosted = 0;
  if (webhookUrl && alerts.length > 0) {
    const fetcher = deps.fetchImpl ?? globalThis.fetch;
    if (typeof fetcher === "function") {
      for (const a of alerts) {
        try {
          void fetcher(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              event: "perfect_track_alert",
              operator_id: a.operator_id,
              match_number: a.match_number,
              alive_count: a.alive_count,
              detected_at: deps.now,
            }),
          })
            .then(() => undefined)
            .catch(() => undefined);
          webhookPosted += 1;
        } catch {
          // Silent: a webhook failure must never block scoring.
        }
      }
    }
  }

  return { alertsRecorded: alerts, webhookPosted };
}

/**
 * Find the highest n >= PERFECT_TRACK_MATCH_THRESHOLD with alive_count
 * > 0 in this summary's bots_alive_after_match_n array. Returns null
 * if no such entry exists.
 */
function pickHighestAlive(row: SwarmSummaryRow): PerfectTrackAlert | null {
  let parsed: Array<{ n: number; alive_count: number }>;
  try {
    parsed = JSON.parse(row.alive_by_match_json) as Array<{
      n: number;
      alive_count: number;
    }>;
    if (!Array.isArray(parsed)) return null;
  } catch {
    return null;
  }
  let best: { n: number; alive_count: number } | null = null;
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry.n === "number" &&
      typeof entry.alive_count === "number" &&
      entry.n >= PERFECT_TRACK_MATCH_THRESHOLD &&
      entry.alive_count > 0
    ) {
      if (!best || entry.n > best.n) best = entry;
    }
  }
  if (!best) return null;
  return {
    operator_id: row.operator_id,
    match_number: best.n,
    alive_count: best.alive_count,
  };
}
