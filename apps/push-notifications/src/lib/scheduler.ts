/**
 * Kickoff scheduler.
 *
 * On startup, scans the loaded tournament's group + knockout fixtures and,
 * for any fixture kicking off in the next 24h, schedules two
 * `kickoff_soon` notifications: one at `kickoff - 30min`, one at
 * `kickoff - 5min`. Past-due times within the 24h window are not
 * scheduled (the user already missed the moment).
 *
 * Scheduled-job state is persisted to disk so a restart doesn't double-
 * schedule. Each (matchId, minutesUntil) pair is keyed deterministically
 * and tracked in `data/scheduled-jobs.json`. The scheduler uses
 * `setTimeout` for all in-process timers — no external job queue.
 *
 * Idempotency: re-running `scheduleAll` after a restart finds the same
 * (matchId, minutesUntil) keys, sees they're already-fired or still-
 * pending, and skips. Only kicked-off-but-not-fired jobs whose timer was
 * lost on shutdown are re-armed.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type {
  GroupFixture,
  KnockoutFixture,
  Tournament,
} from '@vtorn/bracket-engine';
import type { AuditLogger } from './audit.js';

export interface ScheduledJob {
  jobKey: string;
  matchId: string;
  minutesUntil: number;
  fireAt: string; // ISO-8601
  status: 'pending' | 'fired' | 'expired';
}

export interface SchedulerConfig {
  audit: AuditLogger;
  /** Where to persist the scheduled-job state. */
  statePath?: string;
  /** Override `now` for tests. */
  now?: () => Date;
  /** Window over which we schedule jobs at startup. Default 24h. */
  windowMs?: number;
  /** Lead times to fire `kickoff_soon`. Default [30, 5] minutes. */
  leadMinutes?: readonly number[];
  /** Callback invoked when a job fires. Caller does the actual fan-out. */
  onFire: (job: ScheduledJob) => Promise<void> | void;
}

const DEFAULT_LEADS = [30, 5] as const;

export class Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly cfg: Required<
    Omit<SchedulerConfig, 'audit' | 'statePath' | 'onFire'>
  > & {
    audit: AuditLogger;
    statePath: string | null;
    onFire: SchedulerConfig['onFire'];
  };

  constructor(cfg: SchedulerConfig) {
    this.cfg = {
      audit: cfg.audit,
      statePath: cfg.statePath ?? null,
      now: cfg.now ?? (() => new Date()),
      windowMs: cfg.windowMs ?? 24 * 60 * 60 * 1000,
      leadMinutes: cfg.leadMinutes ?? DEFAULT_LEADS,
      onFire: cfg.onFire,
    };
  }

  static jobKey(matchId: string, minutesUntil: number): string {
    return `${matchId}:${minutesUntil}`;
  }

  /** Hydrate persisted state. Call once at startup. */
  async load(): Promise<void> {
    if (!this.cfg.statePath) return;
    try {
      const raw = await fs.readFile(this.cfg.statePath, 'utf8');
      const parsed = JSON.parse(raw) as { jobs: ScheduledJob[] };
      for (const j of parsed.jobs ?? []) {
        this.jobs.set(j.jobKey, j);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  private async persist(): Promise<void> {
    if (!this.cfg.statePath) return;
    await fs.mkdir(dirname(this.cfg.statePath), { recursive: true });
    const out = { jobs: [...this.jobs.values()] };
    await fs.writeFile(this.cfg.statePath, JSON.stringify(out, null, 2), 'utf8');
  }

  /**
   * Scan a tournament's fixtures and add a job for each (fixture, leadMinutes)
   * pair that falls in the upcoming window.
   *
   * Returns the list of jobs added (or already-present-and-pending) so the
   * caller can log a "scheduled N kickoff jobs" line on boot. Already-fired
   * jobs are not re-fired.
   */
  async scheduleAll(tournament: Tournament): Promise<ScheduledJob[]> {
    const now = this.cfg.now();
    const horizon = now.getTime() + this.cfg.windowMs;

    const groupJobs: { matchId: string; kickoff: Date }[] =
      tournament.group_fixtures.map((f: GroupFixture) => ({
        matchId: String(f.match_no),
        kickoff: new Date(f.kickoff_utc),
      }));
    const knockoutJobs: { matchId: string; kickoff: Date }[] =
      tournament.knockouts.map((f: KnockoutFixture) => ({
        matchId: f.id,
        kickoff: new Date(f.kickoff_utc),
      }));
    const all = [...groupJobs, ...knockoutJobs];

    const created: ScheduledJob[] = [];
    for (const fx of all) {
      const ts = fx.kickoff.getTime();
      if (Number.isNaN(ts)) continue;
      // Only consider matches within the upcoming window. Matches earlier
      // than `now` are skipped entirely; matches beyond the window are
      // deferred to the next scheduler scan.
      if (ts < now.getTime() || ts > horizon) continue;

      for (const lead of this.cfg.leadMinutes) {
        const fireAt = new Date(ts - lead * 60_000);
        const jobKey = Scheduler.jobKey(fx.matchId, lead);
        const existing = this.jobs.get(jobKey);
        if (existing && existing.status === 'fired') continue;
        if (fireAt.getTime() <= now.getTime()) {
          // Lead time already elapsed. Mark expired so we don't fire late.
          if (!existing) {
            const expired: ScheduledJob = {
              jobKey,
              matchId: fx.matchId,
              minutesUntil: lead,
              fireAt: fireAt.toISOString(),
              status: 'expired',
            };
            this.jobs.set(jobKey, expired);
          }
          continue;
        }
        const job: ScheduledJob = existing ?? {
          jobKey,
          matchId: fx.matchId,
          minutesUntil: lead,
          fireAt: fireAt.toISOString(),
          status: 'pending',
        };
        this.jobs.set(jobKey, job);
        created.push(job);
        this.armTimer(job);
      }
    }

    await this.persist();
    await this.cfg.audit.append({
      channel: 'system',
      userId: 'scheduler',
      event: 'schedule',
      payload: {
        scanned: all.length,
        scheduled: created.length,
        windowMs: this.cfg.windowMs,
      },
      ok: true,
    });
    return created;
  }

  private armTimer(job: ScheduledJob): void {
    if (this.timers.has(job.jobKey)) return;
    if (job.status !== 'pending') return;
    const delay = new Date(job.fireAt).getTime() - this.cfg.now().getTime();
    if (delay <= 0) {
      // Fire immediately on next tick.
      const t = setTimeout(() => void this.fire(job.jobKey), 0);
      this.timers.set(job.jobKey, t);
      return;
    }
    const t = setTimeout(() => void this.fire(job.jobKey), delay);
    this.timers.set(job.jobKey, t);
  }

  private async fire(jobKey: string): Promise<void> {
    this.timers.delete(jobKey);
    const job = this.jobs.get(jobKey);
    if (!job || job.status !== 'pending') return;
    job.status = 'fired';
    this.jobs.set(jobKey, job);
    await this.persist();
    try {
      await this.cfg.onFire(job);
    } catch (err) {
      await this.cfg.audit.append({
        channel: 'system',
        userId: 'scheduler',
        event: 'schedule',
        payload: { jobKey, err: String(err) },
        ok: false,
        note: 'onFire callback threw',
      });
    }
  }

  /** Cancel all pending timers. Used on shutdown and in tests. */
  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  pendingCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === 'pending') n++;
    return n;
  }

  list(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  /** Test-only: synchronously fire a job by key, bypassing setTimeout. */
  async _fireNow(jobKey: string): Promise<void> {
    const t = this.timers.get(jobKey);
    if (t) {
      clearTimeout(t);
      this.timers.delete(jobKey);
    }
    await this.fire(jobKey);
  }
}
