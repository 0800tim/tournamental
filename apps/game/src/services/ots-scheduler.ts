/**
 * OTS upgrade scheduler — polls calendar servers for pending swarm
 * claims and rewrites the row with the Bitcoin-attested proof once
 * one comes back.
 *
 * Design:
 *   - Every `pollIntervalMs` we pick up every row in `swarm_claims`
 *     with `ots_status='pending'` AND not polled in the last
 *     `stalenessMs` window.
 *   - For each row we walk its pending calendars and call
 *     GET /timestamp/<digest>. The first calendar that returns a
 *     payload containing a Bitcoin block attestation wins; we
 *     persist its upgraded bytes and flip the row to 'confirmed'.
 *   - Calendars that return null (still aggregating) bump the row's
 *     `last_upgrade_attempt_at` so the next sweep waits a while.
 *
 * This is the central-tier mirror of the script the official OTS CLI
 * runs locally (`ots upgrade snapshot.db.ots`). We just keep doing it
 * automatically on the server side and surface the result via the
 * verify route.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §15.6
 */
import {
  bytesToHex,
  fetchUpgrade,
  hexToBytes,
  type CalendarUpgradeResult,
} from "../lib/ots-calendar.js";
import type { SwarmClaimStore, SwarmClaimRow } from "../store/swarm-claims.js";

export interface SchedulerOptions {
  /** How often to wake up and scan. Default 5 minutes. */
  pollIntervalMs?: number;
  /** Don't re-poll a row that was tried in the last N ms. Default 30m. */
  stalenessMs?: number;
  /** Per-cycle limit. Default 50. */
  batchSize?: number;
  /** Per-request timeout. Default 10s. */
  requestTimeoutMs?: number;
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Inject clock for tests. */
  now?: () => number;
}

export class OtsScheduler {
  // `setInterval` returns a `Timeout` (Node) or `number` (browser); we
  // only ever use it on the server side, but typing it as the return
  // value of `setInterval` keeps us off the `NodeJS.*` global namespace
  // which the test tsconfig doesn't pull in.
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly stalenessMs: number;
  private readonly batchSize: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly store: SwarmClaimStore,
    opts: SchedulerOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 5 * 60_000;
    this.stalenessMs = opts.stalenessMs ?? 30 * 60_000;
    this.batchSize = opts.batchSize ?? 50;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    // Fire the first sweep on the next tick so callers can start the
    // scheduler before the DB is fully populated without missing a
    // pending row.
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // Allow the process to exit while the scheduler is the only thing
    // keeping the event loop alive.
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run one sweep. Returns the per-row outcomes so tests and ops can
   * trace progress. Concurrent ticks are serialised because each row
   * we touch is an SQLite write and we don't want N pollers racing.
   */
  async tick(): Promise<Array<{
    node_id: string;
    run_id: string;
    upgraded: boolean;
  }>> {
    if (this.running) return [];
    this.running = true;
    try {
      const pending = this.store.pendingToUpgrade({
        staleness_ms: this.stalenessMs,
        limit: this.batchSize,
        now: this.now(),
      });
      const out: Array<{ node_id: string; run_id: string; upgraded: boolean }> = [];
      for (const row of pending) {
        const upgraded = await this.tryUpgradeRow(row);
        out.push({
          node_id: row.node_id,
          run_id: row.run_id,
          upgraded,
        });
      }
      return out;
    } finally {
      this.running = false;
    }
  }

  /**
   * Attempt to upgrade one row. Walks every pending calendar; first
   * one that comes back with a Bitcoin attestation wins.
   *
   * Returns true iff the row flipped to 'confirmed'. False means we
   * polled but no calendar had a Bitcoin attestation yet — the row
   * stays 'pending' with `last_upgrade_attempt_at` bumped.
   */
  async tryUpgradeRow(row: SwarmClaimRow): Promise<boolean> {
    this.store.recordUpgradeAttempt({
      node_id: row.node_id,
      run_id: row.run_id,
      now: this.now(),
    });
    const blobs = this.store.parsePending(row);
    if (blobs.length === 0) return false;

    let digest: Uint8Array;
    try {
      digest = hexToBytes(row.merkle_root);
    } catch {
      return false;
    }
    const digestHex = bytesToHex(digest);

    for (const blob of blobs) {
      let upgrade: CalendarUpgradeResult | null;
      try {
        upgrade = await fetchUpgrade({
          calendar_url: blob.calendar_url,
          digest_hex: digestHex,
          timeoutMs: this.requestTimeoutMs,
          fetchImpl: this.fetchImpl,
        });
      } catch {
        continue;
      }
      if (!upgrade) continue;
      if (!upgrade.bitcoin_confirmed) {
        // Calendar returned bytes but no BTC attestation yet — keep
        // walking other calendars; one of them might be ahead.
        continue;
      }
      this.store.recordUpgradeSuccess({
        node_id: row.node_id,
        run_id: row.run_id,
        calendar_url: upgrade.calendar_url,
        upgraded_ots_hex: bytesToHex(upgrade.upgraded_bytes),
        now: this.now(),
      });
      return true;
    }
    return false;
  }
}
