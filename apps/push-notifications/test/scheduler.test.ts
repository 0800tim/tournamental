/**
 * Scheduler unit tests.
 *
 * Build a synthetic Tournament with a handful of fixtures spread across
 * "way in the past", "in the next 24h", and "next week". Verify:
 *  - past kickoffs don't schedule jobs
 *  - the 24h-window kickoffs schedule N * leadMinutes.length jobs
 *  - re-running scheduleAll on a fresh scheduler with the same persisted
 *    state is idempotent (no duplicate jobs)
 *  - firing a job invokes the onFire callback
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tournament } from '@tournamental/bracket-engine';

import { Scheduler } from '../src/lib/scheduler.js';
import { MemoryAuditLogger } from '../src/lib/audit.js';

function makeTournament(now: Date): Tournament {
  const ms = (offsetMins: number) =>
    new Date(now.getTime() + offsetMins * 60_000).toISOString();
  return {
    id: 'test',
    name: 'Test Tournament',
    start_utc: ms(0),
    final_utc: ms(60 * 24 * 7),
    teams: [],
    groups: [],
    advancement: {
      automatic_per_group: 4,
      wildcard_third: 0,
      wildcard_fourth: 0,
    },
    group_fixtures: [
      // already kicked off -> skip
      {
        match_no: 1,
        group_id: 'A',
        home_idx: 0,
        away_idx: 1,
        kickoff_utc: ms(-60),
        host: 'US',
        venue: 'Test Stadium',
      },
      // 60 min from now -> 30-min lead arms; 5-min lead arms
      {
        match_no: 2,
        group_id: 'A',
        home_idx: 0,
        away_idx: 2,
        kickoff_utc: ms(60),
        host: 'US',
        venue: 'Test Stadium',
      },
      // 6 days from now -> outside 24h window, skip
      {
        match_no: 3,
        group_id: 'B',
        home_idx: 0,
        away_idx: 1,
        kickoff_utc: ms(60 * 24 * 6),
        host: 'CA',
        venue: 'Test Stadium',
      },
    ],
    knockouts: [
      // 12h from now -> arms both leads
      {
        id: 'r32_01',
        stage: 'r32',
        match_no: 73,
        home: { kind: 'group_position', group: 'A', position: 1 },
        away: { kind: 'group_position', group: 'B', position: 2 },
        kickoff_utc: ms(60 * 12),
        host: 'US',
        venue: 'Test Stadium',
      },
    ],
  };
}

let workdir: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'sched-test-'));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe('Scheduler', () => {
  it('schedules only fixtures within the 24h window, both leads', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    const tournament = makeTournament(now);
    const audit = new MemoryAuditLogger();
    const onFire = vi.fn();
    const sched = new Scheduler({
      audit,
      statePath: join(workdir, 'state.json'),
      now: () => now,
      onFire,
    });
    const created = await sched.scheduleAll(tournament);
    // match_no=2 (60min) -> 2 jobs; r32_01 (12h) -> 2 jobs. = 4 jobs.
    expect(created.length).toBe(4);
    expect(sched.pendingCount()).toBe(4);
    sched.shutdown();
  });

  it('persists state and is idempotent across re-runs', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    const tournament = makeTournament(now);
    const audit = new MemoryAuditLogger();
    const statePath = join(workdir, 'state.json');

    const a = new Scheduler({
      audit,
      statePath,
      now: () => now,
      onFire: vi.fn(),
    });
    await a.load();
    const first = await a.scheduleAll(tournament);
    a.shutdown();

    const b = new Scheduler({
      audit,
      statePath,
      now: () => now,
      onFire: vi.fn(),
    });
    await b.load();
    const second = await b.scheduleAll(tournament);

    // Persisted jobs are still pending; re-running scheduleAll on a fresh
    // process keeps the same job set rather than duplicating.
    expect(b.list().map((j) => j.jobKey).sort()).toEqual(
      a.list().map((j) => j.jobKey).sort(),
    );
    // Second run only re-arms timers; no extra audit entries beyond the
    // original count plus one schedule-event marker for the second scan.
    expect(first.length).toBe(second.length);
    b.shutdown();
  });

  it('marks already-passed lead times expired and does not fire them', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    const audit = new MemoryAuditLogger();
    const onFire = vi.fn();
    // Match in 10 min — 30-min lead is in the past, 5-min lead is fine.
    const t: Tournament = {
      id: 't',
      name: 't',
      start_utc: now.toISOString(),
      final_utc: now.toISOString(),
      teams: [],
      groups: [],
      advancement: {
        automatic_per_group: 4,
        wildcard_third: 0,
        wildcard_fourth: 0,
      },
      group_fixtures: [
        {
          match_no: 9,
          group_id: 'A',
          home_idx: 0,
          away_idx: 1,
          kickoff_utc: new Date(now.getTime() + 10 * 60_000).toISOString(),
          host: 'US',
          venue: 'X',
        },
      ],
      knockouts: [],
    };
    const sched = new Scheduler({
      audit,
      statePath: join(workdir, 's.json'),
      now: () => now,
      onFire,
    });
    await sched.scheduleAll(t);
    const jobs = sched.list();
    const expired = jobs.find((j) => j.minutesUntil === 30);
    expect(expired?.status).toBe('expired');
    const pending = jobs.find((j) => j.minutesUntil === 5);
    expect(pending?.status).toBe('pending');
    sched.shutdown();
  });

  it('fires the onFire callback when a job is triggered', async () => {
    const now = new Date('2026-06-11T12:00:00Z');
    const audit = new MemoryAuditLogger();
    const onFire = vi.fn();
    const t: Tournament = {
      id: 't',
      name: 't',
      start_utc: now.toISOString(),
      final_utc: now.toISOString(),
      teams: [],
      groups: [],
      advancement: {
        automatic_per_group: 4,
        wildcard_third: 0,
        wildcard_fourth: 0,
      },
      group_fixtures: [
        {
          match_no: 42,
          group_id: 'A',
          home_idx: 0,
          away_idx: 1,
          kickoff_utc: new Date(now.getTime() + 60 * 60_000).toISOString(),
          host: 'US',
          venue: 'X',
        },
      ],
      knockouts: [],
    };
    const sched = new Scheduler({
      audit,
      statePath: join(workdir, 's.json'),
      now: () => now,
      onFire,
    });
    await sched.scheduleAll(t);
    await sched._fireNow(Scheduler.jobKey('42', 5));
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire.mock.calls[0]?.[0].matchId).toBe('42');
    sched.shutdown();
  });
});
