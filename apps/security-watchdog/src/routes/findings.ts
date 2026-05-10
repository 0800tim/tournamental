/**
 * Finding lifecycle endpoints.
 *
 *   GET    /v1/findings              list (paginated, filtered)
 *   GET    /v1/findings/:id          one
 *   POST   /v1/findings              ingest a new finding (auth-gated)
 *   POST   /v1/findings/:id/ack      acknowledge (auth-gated)
 *   POST   /v1/findings/:id/resolve  resolve (auth-gated)
 *   POST   /v1/findings/:id/dismiss  dismiss as not-an-issue (auth-gated)
 *
 * Auth: bearer-token check against WATCHDOG_API_TOKEN. The dashboard
 * uses a server-to-server token; humans invoke through the dashboard
 * (which gates with admin RBAC).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  FindingSchema,
  FindingSourceSchema,
  SeveritySchema,
  type Finding,
} from '../lib/types.js';
import type { WatchdogStore } from '../lib/storage.js';
import { AlertDispatcher } from '../alerts/index.js';

interface RouteCtx {
  store: WatchdogStore;
  dispatcher: AlertDispatcher;
  /** Auth predicate. Default checks the WATCHDOG_API_TOKEN env. */
  isAuthorised?: (token: string | undefined) => boolean;
}

function defaultAuth(token: string | undefined): boolean {
  const expected = process.env.WATCHDOG_API_TOKEN;
  if (!expected || expected.length < 16) return false;
  return typeof token === 'string' && token === expected;
}

function bearerOf(headers: Record<string, string | string[] | undefined>): string | undefined {
  const raw = headers['authorization'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return undefined;
  const m = v.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

const ListQuerySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed', 'false-positive']).optional(),
  severityAtLeast: SeveritySchema.optional(),
  source: FindingSourceSchema.optional(),
  since: z
    .string()
    .optional()
    .transform((s) => (s ? Number(s) : undefined))
    .pipe(z.number().int().nonnegative().optional()),
  limit: z
    .string()
    .optional()
    .transform((s) => (s ? Number(s) : 100))
    .pipe(z.number().int().min(1).max(500)),
});

const IngestSchema = FindingSchema.extend({
  // Allow callers to omit firstSeenAt/lastSeenAt; we'll fill them.
  firstSeenAt: z.number().int().nonnegative().optional(),
  lastSeenAt: z.number().int().nonnegative().optional(),
}).transform((f) => ({
  ...f,
  firstSeenAt: f.firstSeenAt ?? Date.now(),
  lastSeenAt: f.lastSeenAt ?? Date.now(),
}));

const StatusBodySchema = z.object({
  by: z.string().min(1).max(120),
  reason: z.string().max(2000).optional(),
});

export function registerFindings(app: FastifyInstance, ctx: RouteCtx): void {
  const auth = ctx.isAuthorised ?? defaultAuth;

  app.get('/v1/findings', async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query', issues: parsed.error.issues };
    }
    const { limit, ...rest } = parsed.data;
    const items = ctx.store.list(rest).slice(0, limit);
    return { items, counts: ctx.store.counts() };
  });

  app.get('/v1/findings/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const f = ctx.store.get(id);
    if (!f) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return f;
  });

  app.post('/v1/findings', async (req, reply) => {
    if (!auth(bearerOf(req.headers))) {
      reply.code(401);
      return { error: 'unauthorised' };
    }
    const parsed = IngestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_input', issues: parsed.error.issues.slice(0, 20) };
    }
    const finding = parsed.data as Finding;
    const { created, finding: stored } = ctx.store.observe(finding);
    if (created) {
      // Dispatch alerts for newly observed findings only — re-observation
      // shouldn't spam channels. Status changes don't dispatch either.
      ctx.dispatcher.dispatch(stored).catch(() => {
        // dispatcher already routes failures to dead-letter
      });
    }
    return { created, finding: stored };
  });

  app.post('/v1/findings/:id/ack', async (req, reply) => {
    if (!auth(bearerOf(req.headers))) {
      reply.code(401);
      return { error: 'unauthorised' };
    }
    const id = (req.params as { id: string }).id;
    const body = StatusBodySchema.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'invalid_input', issues: body.error.issues };
    }
    const updated = ctx.store.setStatus(id, 'acknowledged', body.data.by, body.data.reason);
    if (!updated) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { finding: updated };
  });

  app.post('/v1/findings/:id/resolve', async (req, reply) => {
    if (!auth(bearerOf(req.headers))) {
      reply.code(401);
      return { error: 'unauthorised' };
    }
    const id = (req.params as { id: string }).id;
    const body = StatusBodySchema.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'invalid_input', issues: body.error.issues };
    }
    const updated = ctx.store.setStatus(id, 'resolved', body.data.by, body.data.reason);
    if (!updated) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { finding: updated };
  });

  app.post('/v1/findings/:id/dismiss', async (req, reply) => {
    if (!auth(bearerOf(req.headers))) {
      reply.code(401);
      return { error: 'unauthorised' };
    }
    const id = (req.params as { id: string }).id;
    const body = StatusBodySchema.safeParse(req.body);
    if (!body.success) {
      reply.code(400);
      return { error: 'invalid_input', issues: body.error.issues };
    }
    const status = (req.body as { falsePositive?: boolean })?.falsePositive
      ? 'false-positive'
      : 'dismissed';
    const updated = ctx.store.setStatus(id, status, body.data.by, body.data.reason);
    if (!updated) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { finding: updated };
  });

  app.get('/v1/audit-log', async (req, reply) => {
    if (!auth(bearerOf(req.headers))) {
      reply.code(401);
      return { error: 'unauthorised' };
    }
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return { items: ctx.store.auditLog(Math.min(500, Math.max(1, limit))) };
  });
}
