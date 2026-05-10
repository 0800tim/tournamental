/**
 * Control endpoints for the poll-forwarder.
 *
 *   GET  /healthz                     liveness
 *   GET  /v1/version                  version + commit info
 *   GET  /v1/status                   per-channel status snapshot
 *   POST /v1/admin/pause/:channel     gated pause
 *   POST /v1/admin/resume/:channel    gated resume
 *   POST /v1/admin/replay-failed      gated replay of dead-letter queue
 *
 * Admin endpoints require the `x-poll-admin` header to match the
 * configured `POLL_ADMIN_TOKEN`. The token must be at least 32 chars in
 * production; dev gets a fixed insecure default so smoke tests work
 * without env wiring.
 */

import type { FastifyInstance } from 'fastify';
import type { Forwarder } from '../lib/forwarder.js';
import type { Scheduler } from '../lib/scheduler.js';
import type { DeadLetterQueue, DeadLetterEntry } from '../lib/dead-letter.js';
import type { Channel } from '../types.js';
import { CHANNELS } from '../types.js';

export interface ControlOptions {
  scheduler: Scheduler;
  forwarder: Forwarder;
  deadLetter: DeadLetterQueue;
  adminToken: string;
  version: string;
}

const VALID_CHANNELS = new Set<string>(CHANNELS);

export async function registerControlRoutes(
  app: FastifyInstance,
  opts: ControlOptions,
): Promise<void> {
  app.get('/healthz', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok', ts: new Date().toISOString() };
  });

  app.get('/v1/version', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return {
      service: 'vtorn-dm-poll-forwarder',
      version: opts.version,
      channels: CHANNELS,
    };
  });

  app.get('/v1/status', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { ts: new Date().toISOString(), channels: opts.scheduler.allStatus() };
  });

  const requireAdmin = (req: { headers: Record<string, unknown> }): boolean => {
    const supplied = req.headers['x-poll-admin'];
    if (typeof supplied !== 'string') return false;
    if (!opts.adminToken) return false;
    return constantTimeEq(supplied, opts.adminToken);
  };

  app.post<{ Params: { channel: string } }>('/v1/admin/pause/:channel', async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: 'unauthorized' });
    const ch = req.params.channel;
    if (!VALID_CHANNELS.has(ch)) return reply.code(404).send({ error: 'unknown-channel' });
    const ok = opts.scheduler.pause(ch as Channel);
    return reply.code(ok ? 200 : 404).send({ ok, channel: ch, paused: true });
  });

  app.post<{ Params: { channel: string } }>('/v1/admin/resume/:channel', async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: 'unauthorized' });
    const ch = req.params.channel;
    if (!VALID_CHANNELS.has(ch)) return reply.code(404).send({ error: 'unknown-channel' });
    const ok = opts.scheduler.resume(ch as Channel);
    return reply.code(ok ? 200 : 404).send({ ok, channel: ch, paused: false });
  });

  app.post('/v1/admin/replay-failed', async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: 'unauthorized' });
    const entries = await opts.deadLetter.drain();
    if (entries.length === 0) {
      return reply.send({ replayed: 0, failed: 0, remaining: 0 });
    }
    let replayed = 0;
    const remaining: DeadLetterEntry[] = [];
    for (const entry of entries) {
      const fwd = await opts.forwarder.forward(entry.message);
      if (fwd.ok) replayed += 1;
      else remaining.push({ ...entry, attempts: entry.attempts + fwd.attempts, lastStatus: fwd.status, lastError: fwd.error ?? entry.lastError });
    }
    await opts.deadLetter.rewrite(remaining);
    return reply.send({ replayed, failed: remaining.length, remaining: remaining.length });
  });
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i += 1) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}
